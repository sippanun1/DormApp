import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { asyncHandler } from '../http/asyncHandler.js';
import { badRequest, fromDatabaseError, notFound } from '../http/errors.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export const roomRoutes = Router();
export const roomTypeRoutes = Router();

roomRoutes.get(
  '/',
  requireAuth,
  requireRole('admin', 'staff'),
  asyncHandler(async (_req, res) => {
    const rooms = await prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT r.id, r.room_number, r.rental_type, r.is_active,
             rt.type_key AS room_type, rt.name_th AS room_type_label,
             COALESCE(r.rent_override, rt.default_rent) AS rent,
             COALESCE(r.nightly_override, rt.default_nightly) AS nightly,
             (r.rent_override IS NOT NULL OR r.nightly_override IS NOT NULL) AS price_overridden
      FROM rooms r JOIN room_types rt ON rt.id = r.room_type_id
      ORDER BY r.room_number`;
    res.json({ rooms });
  }),
);

/** Never free text — the two types are a fixed lookup (rule 11, spec §2.5). */
roomTypeRoutes.get(
  '/',
  requireAuth,
  requireRole('admin', 'staff'),
  asyncHandler(async (_req, res) => {
    const room_types = await prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT id, type_key, name_th, name_en, bed_type, default_rent, default_nightly
      FROM room_types WHERE is_active ORDER BY type_key`;
    res.json({ room_types });
  }),
);

const rentalTypeBody = z.object({ new_type: z.enum(['monthly', 'daily']) });

/**
 * PATCH /rooms/:id/rental-type — admin only (S24).
 *
 * We attempt the update and let ADR-004's trigger reject it. Deliberately no
 * pre-check for an active tenancy or a future booking here: the trigger is the
 * single source of truth, and duplicating its logic in application code creates
 * two places to disagree — with the application's copy being the one that can
 * be raced past. We only translate the exception into a clean 409.
 *
 * The trigger also writes the append-only room_type_changes row, so the audit
 * entry cannot be forgotten by a caller who updates the room some other way.
 */
roomRoutes.patch(
  '/:id/rental-type',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const parsed = rentalTypeBody.safeParse(req.body);
    if (!parsed.success) throw badRequest('ต้องระบุประเภทการเช่า (รายเดือน หรือ รายวัน)');

    const exists = await prisma.$queryRaw<{ id: string; rental_type: string }[]>`
      SELECT id, rental_type FROM rooms WHERE id = ${req.params.id}::uuid`;
    if (!exists[0]) throw notFound('ไม่พบห้องนี้');

    // The trigger records who made the change; it reads this setting rather than
    // taking a parameter, because it fires on a plain UPDATE.
    try {
      const rows = await prisma.$queryRaw<{ id: string; room_number: string; rental_type: string }[]>`
        WITH actor AS (SELECT set_config('app.current_user_id', ${req.user!.id}, true))
        UPDATE rooms SET rental_type = ${parsed.data.new_type}
        FROM actor
        WHERE rooms.id = ${req.params.id}::uuid
        RETURNING rooms.id, rooms.room_number, rooms.rental_type`;

      res.json({ room: rows[0] });
    } catch (err) {
      const mapped = fromDatabaseError(err, 'เปลี่ยนประเภทการเช่าไม่ได้ — ห้องนี้มีสัญญาหรือการจองอยู่');
      throw mapped ?? err;
    }
  }),
);
