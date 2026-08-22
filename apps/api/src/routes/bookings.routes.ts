import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { asyncHandler } from '../http/asyncHandler.js';
import { badRequest, conflict, fromDatabaseError, notFound } from '../http/errors.js';
import { requireAuth, requireRole, requirePermission } from '../middleware/auth.js';

export const bookingRoutes = Router();

const createBody = z.object({
  room_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  check_in_date: z.string().date(),
  check_out_date: z.string().date(),
  // Optional: the standard nightly rate for the room's type is used when this
  // is absent. Rule 11 — no price is typed from scratch, only overridden.
  nightly_rate: z.number().positive().optional(),
});

/**
 * POST /bookings — ADR-002.
 *
 * The overlap check is the EXCLUDE constraint's job and only its job. We do not
 * SELECT first to see whether the dates are free: between that read and this
 * write another staff member can book the same room, and the pre-check would
 * have made us confident rather than correct. Insert, let the database refuse,
 * translate the refusal.
 */
bookingRoutes.post(
  '/',
  requireAuth,
  requirePermission('booking.manage'),
  asyncHandler(async (req, res) => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ครบถ้วน');
    const { room_id, tenant_id, check_in_date, check_out_date, nightly_rate } = parsed.data;

    if (check_out_date <= check_in_date) throw badRequest('วันที่ออกต้องหลังวันที่เข้า');

    const roomRows = await prisma.$queryRaw<
      { id: string; room_number: string; rental_type: string; standard_nightly: string }[]
    >`SELECT r.id, r.room_number, r.rental_type,
             COALESCE(r.nightly_override, rt.default_nightly) AS standard_nightly
      FROM rooms r JOIN room_types rt ON rt.id = r.room_type_id
      WHERE r.id = ${room_id}::uuid AND r.is_active`;

    const room = roomRows[0];
    if (!room) throw notFound('ไม่พบห้องนี้');
    // Rule 11: rental type decides which flow staff may start on this room.
    if (room.rental_type !== 'daily') throw conflict(`ห้อง ${room.room_number} เป็นห้องรายเดือน ไม่สามารถจองรายวันได้`);

    const standard = Number(room.standard_nightly);
    const rate = nightly_rate ?? standard;
    const overridden = rate !== standard;

    try {
      const rows = await prisma.$queryRaw<{ id: string; nightly_rate: string; rate_overridden: boolean }[]>`
        INSERT INTO bookings (room_id, tenant_id, check_in_date, check_out_date,
                              nightly_rate, rate_overridden, created_by)
        VALUES (${room_id}::uuid, ${tenant_id}::uuid, ${check_in_date}::date, ${check_out_date}::date,
                ${rate}, ${overridden}, ${req.user!.id}::uuid)
        RETURNING id, nightly_rate, rate_overridden`;

      res.status(201).json({ booking: rows[0] });
    } catch (err) {
      // Never retry against a different room automatically — the staff member chooses.
      const mapped = fromDatabaseError(err, `ห้อง ${room.room_number} ไม่ว่างในช่วงวันที่เลือก`);
      throw mapped ?? err;
    }
  }),
);

const checkInBody = z.object({
  // ADR-011 / rule 5: มัดจำกุญแจ is collected at check-in, and is a different
  // species of money from เงินประกัน. Separate column, never summed with it.
  key_deposit: z.number().min(0).default(0),
  // Nationality defaults ไทย — the common case, and the guest can change it.
  guest_nationality: z.string().trim().min(1).default('ไทย'),
  guest_id_type: z.enum(['thai_id', 'passport', 'driving_license'], {
    errorMap: () => ({ message: 'ต้องระบุประเภทเอกสาร (บัตรประชาชน / พาสปอร์ต / ใบขับขี่)' }),
  }),
  guest_id_number: z.string({ required_error: 'ต้องระบุเลขบัตร' }).trim().min(1, 'ต้องระบุเลขบัตร'),
  guest_address: z.string({ required_error: 'ต้องระบุที่อยู่' }).trim().min(1, 'ต้องระบุที่อยู่'),
});

/**
 * POST /bookings/:id/check-in — the Hotel Act enforcement point (ADR-011).
 *
 * The status change and the guest_registrations row are one statement, so there
 * is no ordering in which a guest ends up checked in without a registration on
 * file. This is why it is a CTE rather than two awaited queries: the pooled
 * connection runs in pgbouncer transaction mode, where an interactive
 * transaction is not guaranteed to hold the same backend between statements.
 *
 * S12 has no skip path in the UI. This is the reason that promise holds.
 */
bookingRoutes.post(
  '/:id/check-in',
  requireAuth,
  requirePermission('booking.manage'),
  asyncHandler(async (req, res) => {
    const parsed = checkInBody.safeParse(req.body);
    if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'ข้อมูลผู้เข้าพักไม่ครบถ้วน');
    const b = parsed.data;

    const rows = await prisma.$queryRaw<{ id: string; status: string }[]>`
      WITH moved AS (
        UPDATE bookings
        SET status = 'checked_in', key_deposit = ${b.key_deposit}
        WHERE id = ${req.params.id}::uuid AND status = 'confirmed'
        RETURNING id, status
      ), registered AS (
        INSERT INTO guest_registrations (booking_id, guest_nationality, guest_id_type,
                                         guest_id_number, guest_address)
        SELECT id, ${b.guest_nationality}, ${b.guest_id_type}, ${b.guest_id_number}, ${b.guest_address}
        FROM moved
        RETURNING booking_id
      )
      SELECT moved.id, moved.status FROM moved JOIN registered ON registered.booking_id = moved.id`;

    // No row back means the UPDATE matched nothing: wrong id, or the booking was
    // not 'confirmed' — already checked in, cancelled, or a no-show.
    if (!rows[0]) throw conflict('เช็คอินไม่ได้ — การจองนี้ไม่อยู่ในสถานะ "จองแล้ว"');

    res.json({ booking: rows[0] });
  }),
);

/**
 * Departure, and the daily half of rule 4.
 *
 * มัดจำกุญแจ settles here and only here — it is a different species of money
 * from เงินประกัน and is never summed with it (rule 5). A deduction may consume
 * the key deposit and never exceed it: the CHECK constraint added in 005 is
 * what enforces that, so a lost key cannot become a charge to chase.
 */
const checkOutBody = z.object({
  refund_key_deposit: z.boolean().default(true),
  key_deposit_deducted: z.number().min(0).default(0),
});

bookingRoutes.post(
  '/:id/check-out',
  requireAuth,
  requirePermission('booking.manage'),
  asyncHandler(async (req, res) => {
    const parsed = checkOutBody.safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest('ข้อมูลไม่ถูกต้อง');

    // Keys not returned forfeits the whole deposit, so a partial deduction on
    // top of that would be double-counting.
    const deducted = parsed.data.refund_key_deposit ? parsed.data.key_deposit_deducted : 0;

    try {
      const rows = await prisma.$queryRaw<
        { id: string; status: string; key_deposit_refunded: boolean; key_deposit_refund: number }[]
      >`
        UPDATE bookings
        SET status = 'checked_out',
            key_deposit_refunded = ${parsed.data.refund_key_deposit},
            key_deposit_deducted = ${deducted}
        WHERE id = ${req.params.id}::uuid AND status = 'checked_in'
        RETURNING id, status, key_deposit_refunded,
                  -- What actually goes back across the desk, floored at zero by
                  -- the same rule the monthly settlement follows.
                  (CASE WHEN key_deposit_refunded
                        THEN GREATEST(key_deposit - key_deposit_deducted, 0)
                        ELSE 0 END)::float8 AS key_deposit_refund`;

      if (!rows[0]) throw conflict('เช็คเอาต์ไม่ได้ — การจองนี้ไม่ได้อยู่ในสถานะ "เข้าพักอยู่"');
      res.json({ booking: rows[0] });
    } catch (err) {
      // CHECK (key_deposit_deducted <= key_deposit) — rule 4 on the daily side.
      const mapped = fromDatabaseError(err, 'หักมัดจำกุญแจเกินยอดที่วางไว้ไม่ได้');
      throw mapped ?? err;
    }
  }),
);

/**
 * Cancel, or mark a no-show.
 *
 * Rule 8: a no-show is a manual staff action, never an automatic timer, and it
 * forfeits whatever was paid — which for a walk-in reservation is usually ฿0.
 * Both statuses free the dates: the EXCLUDE constraint only covers
 * confirmed/checked_in.
 */
const cancelBody = z.object({ no_show: z.boolean().default(false) });

bookingRoutes.post(
  '/:id/cancel',
  requireAuth,
  requirePermission('booking.manage'),
  asyncHandler(async (req, res) => {
    const parsed = cancelBody.safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest('ข้อมูลไม่ถูกต้อง');
    const status = parsed.data.no_show ? 'no_show' : 'cancelled';

    const rows = await prisma.$queryRaw<{ id: string; status: string }[]>`
      UPDATE bookings SET status = ${status}
      WHERE id = ${req.params.id}::uuid AND status IN ('confirmed', 'checked_in')
      RETURNING id, status`;

    if (!rows[0]) throw conflict('ยกเลิกไม่ได้ — การจองนี้สิ้นสุดไปแล้ว');
    res.json({ booking: rows[0] });
  }),
);

/** One booking with its room, guest and registration status. */
bookingRoutes.get(
  '/:id',
  requireAuth,
  requirePermission('booking.manage'),
  asyncHandler(async (req, res) => {
    const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT b.id, b.check_in_date, b.check_out_date, b.nightly_rate, b.rate_overridden,
             b.status, b.key_deposit, b.key_deposit_refunded,
             r.room_number, rt.name_th AS room_type_label,
             t.full_name AS tenant_name, t.phone AS tenant_phone,
             (g.id IS NOT NULL) AS registered
      FROM bookings b
      JOIN rooms r ON r.id = b.room_id
      JOIN room_types rt ON rt.id = r.room_type_id
      JOIN tenants t ON t.id = b.tenant_id
      LEFT JOIN guest_registrations g ON g.booking_id = b.id
      WHERE b.id = ${req.params.id}::uuid`;

    if (!rows[0]) throw notFound('ไม่พบการจองนี้');
    res.json({ booking: rows[0] });
  }),
);
