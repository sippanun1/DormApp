import { Router } from 'express';
import { z } from 'zod';
import { recordAudit } from '../db/audit.js';
import { prisma } from '../db/prisma.js';
import { asyncHandler } from '../http/asyncHandler.js';
import { badRequest, fromDatabaseError, notFound } from '../http/errors.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export const settingsRoutes = Router();
export const utilityRateRoutes = Router();
export const auditRoutes = Router();

/**
 * Owner-only surfaces: standard prices (S24), utility rates (S24), the
 * policies (S43) and the log that reads them all back (S45).
 *
 * Everything here writes `audit_log`. These are the settings whose change moves
 * money for 60 rooms at once, and "who changed the electric rate, and when" is
 * a question that gets asked after the fact or not at all.
 */

const priceBody = z.object({
  default_rent: z.number().positive().optional(),
  default_nightly: z.number().positive().optional(),
});

/**
 * PATCH /room-types/:id — the standard price for a bed type.
 *
 * Rule 2 in its most consequential form: this changes what FUTURE contracts
 * start at and nothing else. Existing tenancies carry their own frozen
 * `monthly_rent`, and no query here touches them — a signed contract's rent is
 * not the room's current price and never becomes it.
 */
settingsRoutes.patch(
  '/room-types/:id',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const parsed = priceBody.safeParse(req.body);
    if (!parsed.success || (!parsed.data.default_rent && !parsed.data.default_nightly)) {
      throw badRequest('ต้องระบุราคาที่ต้องการเปลี่ยน');
    }

    const before = await prisma.$queryRaw<
      { id: string; name_th: string; default_rent: string; default_nightly: string }[]
    >`SELECT id, name_th, default_rent, default_nightly FROM room_types WHERE id = ${req.params.id}::uuid`;
    const old = before[0];
    if (!old) throw notFound('ไม่พบประเภทห้องนี้');

    const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
      UPDATE room_types
      SET default_rent    = COALESCE(${parsed.data.default_rent ?? null}, default_rent),
          default_nightly = COALESCE(${parsed.data.default_nightly ?? null}, default_nightly)
      WHERE id = ${req.params.id}::uuid
      RETURNING id, type_key, name_th,
                default_rent::float8 AS default_rent,
                default_nightly::float8 AS default_nightly`;

    await recordAudit(
      'room_type',
      old.id,
      'price_changed',
      {
        name: old.name_th,
        from: { rent: Number(old.default_rent), nightly: Number(old.default_nightly) },
        to: { rent: rows[0]?.default_rent, nightly: rows[0]?.default_nightly },
      },
      req.user!.id,
    );

    // Stated in the response, not just in the UI: a caller integrating against
    // this endpoint should not have to guess whether contracts moved.
    res.json({ room_type: rows[0], affects: 'future_contracts_only' });
  }),
);

const overrideBody = z.object({
  rent_override: z.number().positive().nullable().optional(),
  nightly_override: z.number().positive().nullable().optional(),
});

/**
 * PATCH /rooms/:id/price — a per-room exception to the standard price.
 *
 * NULL clears it and returns the room to its type's price. Rule 11: no price is
 * typed from scratch anywhere, only overridden — and the override stays visibly
 * an override, which is why `rent_override` is a separate column rather than a
 * value written over the standard one.
 */
settingsRoutes.patch(
  '/rooms/:id/price',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const parsed = overrideBody.safeParse(req.body);
    if (!parsed.success) throw badRequest('ราคาไม่ถูกต้อง');
    const { rent_override, nightly_override } = parsed.data;
    if (rent_override === undefined && nightly_override === undefined) {
      throw badRequest('ต้องระบุราคาที่ต้องการกำหนดหรือยกเลิก');
    }

    const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
      UPDATE rooms
      SET rent_override    = ${rent_override === undefined ? null : rent_override},
          nightly_override = ${nightly_override === undefined ? null : nightly_override}
      WHERE id = ${req.params.id}::uuid
      RETURNING id, room_number,
                rent_override::float8 AS rent_override,
                nightly_override::float8 AS nightly_override`;

    const room = rows[0];
    if (!room) throw notFound('ไม่พบห้องนี้');

    await recordAudit('room', String(room.id), 'price_override', { room_number: room.room_number, rent_override, nightly_override }, req.user!.id);
    res.json({ room, affects: 'future_contracts_only' });
  }),
);

/**
 * Utility rates are effective-dated, never edited.
 *
 * A reading already froze its own rate into `meter_readings.rate` when it was
 * entered, so a new rate cannot retroactively change a bill that has been
 * issued — and the history stays readable, which is what a tenant asking "why
 * is this month more expensive" needs.
 */
utilityRateRoutes.get(
  '/',
  requireAuth,
  requireRole('admin', 'staff'),
  asyncHandler(async (_req, res) => {
    const rates = await prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT ur.id, ur.meter_type, ur.rate::float8 AS rate, ur.effective_from,
             u.name AS created_by_name, ur.created_at,
             (ur.effective_from <= bangkok_today()
              AND NOT EXISTS (
                SELECT 1 FROM utility_rates later
                WHERE later.meter_type = ur.meter_type
                  AND later.effective_from <= bangkok_today()
                  AND later.effective_from > ur.effective_from
              )) AS is_current
      FROM utility_rates ur
      JOIN users u ON u.id = ur.created_by
      ORDER BY ur.meter_type, ur.effective_from DESC`;
    res.json({ rates });
  }),
);

const rateBody = z.object({
  meter_type: z.enum(['water', 'electric']),
  rate: z.number().positive(),
  effective_from: z.string().date(),
});

utilityRateRoutes.post(
  '/',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const parsed = rateBody.safeParse(req.body);
    if (!parsed.success) throw badRequest('ข้อมูลอัตราค่าบริการไม่ครบถ้วน');
    const { meter_type, rate, effective_from } = parsed.data;

    try {
      const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
        INSERT INTO utility_rates (meter_type, rate, effective_from, created_by)
        VALUES (${meter_type}, ${rate}, ${effective_from}::date, ${req.user!.id}::uuid)
        RETURNING id, meter_type, rate::float8 AS rate, effective_from`;

      await recordAudit('utility_rate', String(rows[0]?.id), 'rate_added', { meter_type, rate, effective_from }, req.user!.id);
      res.status(201).json({ rate: rows[0] });
    } catch (err) {
      // UNIQUE (meter_type, effective_from): one rate per meter per start date,
      // so a double-submit cannot leave two rates competing for the same month.
      const mapped = fromDatabaseError(err, 'มีอัตราของวันที่นี้อยู่แล้ว');
      throw mapped ?? err;
    }
  }),
);

/** S43 — the policies that used to be hardcoded in the prototype. */
settingsRoutes.get(
  '/settings',
  requireAuth,
  requireRole('admin', 'staff'),
  asyncHandler(async (_req, res) => {
    const settings = await prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT s.key, s.value, s.value_type, s.updated_at, u.name AS updated_by_name
      FROM system_settings s
      LEFT JOIN users u ON u.id = s.updated_by
      ORDER BY s.key`;
    res.json({ settings });
  }),
);

const settingBody = z.object({ value: z.string().trim().min(1) });

settingsRoutes.patch(
  '/settings/:key',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const parsed = settingBody.safeParse(req.body);
    if (!parsed.success) throw badRequest('ต้องระบุค่าที่ต้องการตั้ง');

    const before = await prisma.$queryRaw<{ key: string; value: string; value_type: string }[]>`
      SELECT key, value, value_type FROM system_settings WHERE key = ${req.params.key}`;
    const old = before[0];
    // Keys are created by the seed, never by a caller: a typo'd key would
    // otherwise become a policy nothing reads.
    if (!old) throw notFound('ไม่พบการตั้งค่านี้');

    // Typed, because these values are cast in SQL — `due_day` is read as ::int
    // by invoice generation, and a non-numeric string there breaks the month's
    // run rather than this request.
    if ((old.value_type === 'int' || old.value_type === 'money') && !/^\d+(\.\d+)?$/.test(parsed.data.value)) {
      throw badRequest('ค่านี้ต้องเป็นตัวเลข');
    }
    if (old.value_type === 'bool' && !['true', 'false'].includes(parsed.data.value)) {
      throw badRequest('ค่านี้ต้องเป็น true หรือ false');
    }

    const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
      UPDATE system_settings
      SET value = ${parsed.data.value}, updated_by = ${req.user!.id}::uuid, updated_at = now()
      WHERE key = ${req.params.key}
      RETURNING key, value, value_type, updated_at`;

    await recordAudit('system_setting', null, 'setting_changed',
      { key: old.key, from: old.value, to: parsed.data.value }, req.user!.id);

    res.json({ setting: rows[0] });
  }),
);

/**
 * S45 — the audit log, read back.
 *
 * Owner-only, and read-only: there is no endpoint that edits or deletes a row
 * here, deliberately. Six screens promise that something is recorded; this is
 * where that promise is checked.
 */
auditRoutes.get(
  '/',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const entityType = typeof req.query.entity_type === 'string' ? req.query.entity_type : null;
    const limit = Math.min(Number(req.query.limit) || 100, 500);

    const entries = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT a.id, a.entity_type, a.entity_id, a.action, a.detail, a.created_at,
              u.name AS actor_name, u.role AS actor_role
       FROM audit_log a
       JOIN users u ON u.id = a.actor_id
       WHERE ($1::text IS NULL OR a.entity_type = $1::text)
       ORDER BY a.created_at DESC
       LIMIT $2::int`,
      entityType,
      limit,
    );

    const types = await prisma.$queryRaw<{ entity_type: string; count: bigint }[]>`
      SELECT entity_type, COUNT(*) AS count FROM audit_log GROUP BY entity_type ORDER BY entity_type`;

    res.json({
      entries,
      entity_types: types.map((t) => ({ entity_type: t.entity_type, count: Number(t.count) })),
    });
  }),
);
