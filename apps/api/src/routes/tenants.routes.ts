import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { asyncHandler } from '../http/asyncHandler.js';
import { badRequest, conflict, notFound } from '../http/errors.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export const tenantRoutes = Router();

/**
 * ADR-013: `tenants` is the shared identity behind both bookings and tenancies.
 * Neither check-in flow accepts a raw name and phone — both need a tenant_id,
 * obtained here first. Keeping lookup and creation as separate calls is what
 * makes a 409 from either one unambiguous about which thing failed.
 */

const phoneQuery = z.object({ phone: z.string().trim().min(9) });

tenantRoutes.get(
  '/',
  requireAuth,
  requireRole('admin', 'staff'),
  asyncHandler(async (req, res) => {
    const parsed = phoneQuery.safeParse(req.query);
    if (!parsed.success) throw badRequest('ต้องระบุเบอร์โทรศัพท์');

    // Exact match only. The frontend falls through to creation on a 404 — it
    // never fuzzy-matches a name, which would silently merge two people.
    const rows = await prisma.$queryRaw<
      { id: string; full_name: string; phone: string; date_of_birth: Date | null; national_id: string | null }[]
    >`SELECT id, full_name, phone, date_of_birth, national_id
      FROM tenants WHERE phone = ${parsed.data.phone} LIMIT 1`;

    const tenant = rows[0];
    if (!tenant) throw notFound('ไม่พบผู้เช่าจากเบอร์นี้');

    res.json({ tenant });
  }),
);

/**
 * S44 — the tenant register: everyone who has ever stayed, current or past.
 *
 * Distinct from the phone lookup above, which is exact-match on purpose. This
 * one searches names as well, because it answers "who was in 203 last year",
 * not "is this person already in the system" — a fuzzy answer is useful here
 * and dangerous there (it would silently merge two people at check-in).
 */
tenantRoutes.get(
  '/directory',
  requireAuth,
  requireRole('admin', 'staff'),
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

    const tenants = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT t.id, t.full_name, t.phone,
              (t.line_user_id IS NOT NULL) AS line_linked,
              cur.room_number    AS current_room,
              cur.tenancy_id     AS current_tenancy_id,
              cur.kind           AS current_kind,
              last.room_number   AS last_room,
              last.ended_on      AS last_ended_on,
              stats.stay_count::int AS stay_count
       FROM tenants t
       -- Where they are right now: an active contract, or a guest checked in.
       LEFT JOIN LATERAL (
         SELECT r.room_number, tn.id AS tenancy_id, 'monthly' AS kind
         FROM tenancies tn JOIN rooms r ON r.id = tn.room_id
         WHERE tn.tenant_id = t.id AND tn.status = 'active'
         UNION ALL
         SELECT r.room_number, NULL, 'daily'
         FROM bookings b JOIN rooms r ON r.id = b.room_id
         WHERE b.tenant_id = t.id AND b.status = 'checked_in'
         LIMIT 1
       ) cur ON TRUE
       LEFT JOIN LATERAL (
         SELECT r.room_number, tn.end_date AS ended_on
         FROM tenancies tn JOIN rooms r ON r.id = tn.room_id
         WHERE tn.tenant_id = t.id AND tn.status <> 'active'
         ORDER BY tn.end_date DESC NULLS LAST LIMIT 1
       ) last ON TRUE
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS stay_count FROM (
           SELECT id FROM tenancies WHERE tenant_id = t.id
           UNION ALL
           SELECT id FROM bookings WHERE tenant_id = t.id AND status IN ('checked_in', 'checked_out')
         ) s
       ) stats ON TRUE
       WHERE $1::text = '' OR t.full_name ILIKE '%' || $1::text || '%' OR t.phone LIKE '%' || $1::text || '%'
       ORDER BY (cur.room_number IS NULL), cur.room_number, t.full_name
       LIMIT 200`,
      q,
    );

    res.json({ tenants, count: tenants.length });
  }),
);

const createBody = z.object({
  full_name: z.string().trim().min(1, 'ต้องระบุชื่อ-นามสกุล'),
  phone: z.string().trim().min(9, 'เบอร์โทรไม่ถูกต้อง'),
  // §5: never require these of a walk-in guest who won't give them, and never
  // infer or auto-fill either one.
  date_of_birth: z.string().date().optional(),
  national_id: z.string().trim().optional(),
});

tenantRoutes.post(
  '/',
  requireAuth,
  requireRole('admin', 'staff'),
  asyncHandler(async (req, res) => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ครบถ้วน');
    const { full_name, phone, date_of_birth, national_id } = parsed.data;

    // Guards the case where two staff members do lookup-then-create at once:
    // point at the existing tenant rather than creating a duplicate person.
    const existing = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM tenants WHERE phone = ${phone} LIMIT 1`;
    if (existing[0]) throw conflict(`เบอร์นี้มีผู้เช่าอยู่แล้ว (tenant_id ${existing[0].id})`);

    const rows = await prisma.$queryRaw<{ id: string; full_name: string; phone: string }[]>`
      INSERT INTO tenants (full_name, phone, date_of_birth, national_id)
      VALUES (${full_name}, ${phone}, ${date_of_birth ?? null}::date, ${national_id ?? null})
      RETURNING id, full_name, phone`;

    res.status(201).json({ tenant: rows[0] });
  }),
);
