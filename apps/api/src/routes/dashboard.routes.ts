import { Router } from 'express';
import { prisma } from '../db/prisma.js';
import { asyncHandler } from '../http/asyncHandler.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export const dashboardRoutes = Router();

/** One row per room, straight from the join — before any role shaping. */
interface RoomRow {
  id: string;
  room_number: string;
  rental_type: 'monthly' | 'daily';
  type_key: 'single' | 'double';
  type_label: string;
  rent: string;
  nightly: string;
  price_overridden: boolean;
  tenancy_id: string | null;
  booking_id: string | null;
  occupant_name: string | null;
  occupant_phone: string | null;
  status: 'vacant' | 'occupied_monthly' | 'occupied_daily' | 'reserved';
}

/**
 * §5: status is computed here by joining rooms against active tenancies and
 * in-progress bookings — never stored redundantly on `rooms`. Two rooms cannot
 * disagree with their own occupancy because there is nothing to get stale.
 *
 * Note the ordering of the CASE: an active monthly tenancy outranks any booking,
 * and a checked-in guest outranks a future reservation.
 */
const ROOMS_QUERY = `
  SELECT r.id,
         r.room_number,
         r.rental_type,
         rt.type_key,
         rt.name_th AS type_label,
         COALESCE(r.rent_override,    rt.default_rent)    AS rent,
         COALESCE(r.nightly_override, rt.default_nightly) AS nightly,
         (r.rent_override IS NOT NULL OR r.nightly_override IS NOT NULL) AS price_overridden,
         ten.id       AS tenancy_id,
         bk.id        AS booking_id,
         COALESCE(ten_t.full_name, bk_t.full_name) AS occupant_name,
         COALESCE(ten_t.phone,     bk_t.phone)     AS occupant_phone,
         CASE
           WHEN ten.id IS NOT NULL                     THEN 'occupied_monthly'
           WHEN bk.status = 'checked_in'               THEN 'occupied_daily'
           WHEN bk.id IS NOT NULL                      THEN 'reserved'
           ELSE 'vacant'
         END AS status
  FROM rooms r
  JOIN room_types rt ON rt.id = r.room_type_id
  LEFT JOIN LATERAL (
      SELECT t.id, t.tenant_id FROM tenancies t
      WHERE t.room_id = r.id AND t.status = 'active'
      LIMIT 1
  ) ten ON TRUE
  LEFT JOIN tenants ten_t ON ten_t.id = ten.tenant_id
  LEFT JOIN LATERAL (
      SELECT b.id, b.status, b.tenant_id FROM bookings b
      WHERE b.room_id = r.id
        AND b.status IN ('confirmed', 'checked_in')
        AND b.check_out_date > bangkok_today()
      ORDER BY CASE b.status WHEN 'checked_in' THEN 0 ELSE 1 END, b.check_in_date
      LIMIT 1
  ) bk ON TRUE
  LEFT JOIN tenants bk_t ON bk_t.id = bk.tenant_id
  WHERE r.is_active
  ORDER BY r.room_number
`;

/** Floor is the first digit: 101–115 is floor 1, 401–415 is floor 4. */
const floorOf = (roomNumber: string) => Number(roomNumber[0]);

/**
 * Worker view — ADR/spec §5.3, enforced at the response-shaping layer rather
 * than by a missing UI element. Built as its own serializer on purpose: a
 * stripped-down copy of the admin shape is one forgotten field away from
 * leaking a tenant's name, and "we didn't render it" is not access control.
 *
 * A worker learns whether a room is occupied — which is what housekeeping and
 * maintenance need — and nothing about who is in it or what they pay.
 */
function serializeForWorker(rows: RoomRow[]) {
  return rows.map((r) => ({
    room_number: r.room_number,
    floor: floorOf(r.room_number),
    rental_type: r.rental_type,
    occupied: r.status === 'occupied_monthly' || r.status === 'occupied_daily',
  }));
}

function serializeForStaff(rows: RoomRow[]) {
  return rows.map((r) => ({
    id: r.id,
    room_number: r.room_number,
    floor: floorOf(r.room_number),
    rental_type: r.rental_type,
    room_type: r.type_key,
    room_type_label: r.type_label,
    status: r.status,
    // Rule 11: a price that came from an override must always be visibly an override.
    rent: Number(r.rent),
    nightly: Number(r.nightly),
    price_overridden: r.price_overridden,
    tenancy_id: r.tenancy_id,
    booking_id: r.booking_id,
    occupant: r.occupant_name ? { name: r.occupant_name, phone: r.occupant_phone } : null,
  }));
}

/**
 * S28 — what the front desk has to deal with today.
 *
 * Every date comparison is against bangkok_today(), never the server's date:
 * on the UTC pooler "today" is yesterday for seven hours every morning, which
 * is exactly the window in which a desk opens this screen.
 *
 * Contracts expiring are computed from start_date + agreed_months (rule 12) —
 * there is no stored end date on an active contract, and inventing one would
 * give two answers to the same question.
 */
dashboardRoutes.get(
  '/today',
  requireAuth,
  requireRole('admin', 'staff'),
  asyncHandler(async (_req, res) => {
    const arrivals = await prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT b.id, b.check_in_date, b.check_out_date, b.nightly_rate::float8 AS nightly_rate,
             r.room_number, t.full_name AS tenant_name, t.phone AS tenant_phone
      FROM bookings b
      JOIN rooms r ON r.id = b.room_id
      JOIN tenants t ON t.id = b.tenant_id
      WHERE b.status = 'confirmed' AND b.check_in_date <= bangkok_today()
        AND b.check_out_date > bangkok_today()
      ORDER BY r.room_number`;

    const departures = await prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT b.id, b.check_out_date, b.key_deposit::float8 AS key_deposit,
             r.room_number, t.full_name AS tenant_name
      FROM bookings b
      JOIN rooms r ON r.id = b.room_id
      JOIN tenants t ON t.id = b.tenant_id
      WHERE b.status = 'checked_in' AND b.check_out_date <= bangkok_today()
      ORDER BY r.room_number`;

    const expiring = await prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT tn.id, tn.start_date, tn.agreed_months,
             (tn.start_date + (tn.agreed_months || ' months')::interval)::date AS ends_on,
             ((tn.start_date + (tn.agreed_months || ' months')::interval)::date - bangkok_today()) AS days_left,
             r.room_number, t.full_name AS tenant_name, t.phone AS tenant_phone
      FROM tenancies tn
      JOIN rooms r ON r.id = tn.room_id
      JOIN tenants t ON t.id = tn.tenant_id
      WHERE tn.status = 'active'
        AND (tn.start_date + (tn.agreed_months || ' months')::interval)::date
            <= bangkok_today() + INTERVAL '30 days'
      ORDER BY ends_on`;

    // The queue's own count, so the desk sees the owner has slips waiting
    // without being able to open them (ADR-007 — the list itself is admin-only).
    const pending = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) AS count FROM payments p
      JOIN invoices i ON i.id = p.invoice_id
      WHERE p.verified_at IS NULL AND i.status = 'pending_verification'`;

    const overdue = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) AS count FROM invoices
      WHERE status = 'unpaid' AND due_date < bangkok_today()`;

    res.json({
      arrivals,
      departures,
      expiring,
      pending_verifications: Number(pending[0]?.count ?? 0),
      overdue_invoices: Number(overdue[0]?.count ?? 0),
    });
  }),
);

dashboardRoutes.get(
  '/rooms',
  requireAuth,
  requireRole('admin', 'staff', 'worker'),
  asyncHandler(async (req, res) => {
    const rows = await prisma.$queryRawUnsafe<RoomRow[]>(ROOMS_QUERY);

    if (req.user!.role === 'worker') {
      res.json({ rooms: serializeForWorker(rows) });
      return;
    }

    const rooms = serializeForStaff(rows);
    res.json({
      rooms,
      summary: {
        total: rooms.length,
        vacant: rooms.filter((r) => r.status === 'vacant').length,
        occupied: rooms.filter((r) => r.status.startsWith('occupied')).length,
        reserved: rooms.filter((r) => r.status === 'reserved').length,
        monthly: rooms.filter((r) => r.rental_type === 'monthly').length,
        daily: rooms.filter((r) => r.rental_type === 'daily').length,
      },
    });
  }),
);
