import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { asyncHandler } from '../http/asyncHandler.js';
import { badRequest, conflict, fromDatabaseError, notFound } from '../http/errors.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';

export const meterRoutes = Router();
export const meterReadingRoutes = Router();

const readingEntry = z.object({
  meter_type: z.enum(['water', 'electric']),
  /**
   * ADR-008 and rule 9 look contradictory but describe different moments, and
   * the server enforces the distinction rather than trusting the client:
   *
   *   Continuing month — old_reading IS last month's new_reading on the same
   *   meter for the same tenant. That is arithmetic, not a guess, so the server
   *   DERIVES it and rejects a client value that disagrees. Typing it by hand
   *   only introduces typos that break the chain.
   *
   *   First reading of a tenancy — copying the previous tenant's closing value
   *   is exactly what ADR-008 forbids: the meter may have run between tenancies
   *   and the new tenant would silently pay for it. It must be read off the
   *   physical meter, and any difference from the old closing value has to be
   *   confirmed deliberately.
   */
  old_reading: z.number().min(0).optional(),
  new_reading: z.number().min(0),
  // Rule 9: a broken meter yields an estimate, flagged ประมาณการ, never a guess
  // that looks like a real reading.
  is_estimated: z.boolean().default(false),
  // Only meaningful on a tenancy's first reading: staff have looked at the dial
  // and accept that it differs from the previous tenant's closing value.
  confirm_opening: z.boolean().default(false),
  /**
   * The meter on the wall is not the one the chain was built from — it was
   * replaced, or it wrapped past 9,999. Owner, 2026-08-15: replacement happens
   * "not often", and the crossing month is billed from the previous month's
   * figure rather than by splitting usage across the two meters.
   *
   * That practice needs exactly one thing from the schema, under either reading
   * of it: permission to start a new chain from a dial that does not continue
   * the old one. The crossing month itself is an ordinary is_estimated reading.
   * Every re-base writes to audit_log, because silently accepting a lower
   * number is indistinguishable from the typo we reject everywhere else.
   */
  meter_replaced: z.boolean().default(false),
});

const readingsBody = z.object({
  reading_period: z.string().date(),
  readings: z.array(readingEntry).min(1, 'ต้องมีอย่างน้อยหนึ่งมิเตอร์').max(2),
});

/**
 * POST /tenancies/:id/meter-readings
 *
 * Both meters in one call because that is how staff collect them — one visit to
 * the room. All-or-nothing: a single INSERT..SELECT over unnest, so there is no
 * outcome where the electric reading saves and the water one silently doesn't.
 *
 * Submitting only one utility is valid (ADR-015) — the water meter may be
 * behind a locked door today. Completeness is enforced at invoice generation,
 * not here.
 */
meterRoutes.post(
  '/:id/meter-readings',
  requireAuth,
  requirePermission('meter.record'),
  asyncHandler(async (req, res) => {
    const parsed = readingsBody.safeParse(req.body);
    if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'ข้อมูลมิเตอร์ไม่ครบถ้วน');
    const { reading_period, readings } = parsed.data;

    if (new Set(readings.map((r) => r.meter_type)).size !== readings.length) {
      throw badRequest('ส่งมิเตอร์ชนิดเดียวกันซ้ำในคำขอเดียว');
    }

    const tenancyRows = await prisma.$queryRaw<{ id: string; room_id: string; status: string }[]>`
      SELECT id, room_id, status FROM tenancies WHERE id = ${req.params.id}::uuid`;
    const tenancy = tenancyRows[0];
    if (!tenancy) throw notFound('ไม่พบสัญญานี้');
    if (tenancy.status !== 'active') throw conflict('สัญญานี้สิ้นสุดแล้ว ไม่สามารถบันทึกมิเตอร์ได้');

    // Resolve each entry's old_reading before anything is written.
    const resolvedOld: number[] = [];

    for (const r of readings) {
      const label = r.meter_type === 'water' ? 'น้ำ' : 'ไฟ';

      // The last reading on this CONTRACT CHAIN, on THIS ROOM.
      //
      // The chain, not the single tenancy: a renewal is a new tenancy row for
      // the same tenant in the same room (Rule 4.8), and the meter on the wall
      // did not restart because a contract was re-signed. Reading only this row
      // would present a renewal as a move-in and ask staff to confirm an
      // "opening" value against their own previous close.
      //
      // And the room, not just the chain: a transfer keeps the contract but
      // changes the physical meter (rule 13). Without the room filter this
      // would hand the new room's first bill the OLD room's dial. Both halves
      // live in `chain_previous_reading` (012) rather than here, because three
      // call sites derive this and three copies of the rule is three chances
      // for them to disagree — the same reasoning 006 gives for tenancy_chain.
      const ownRows = await prisma.$queryRaw<{ previous: string | null }[]>`
        SELECT chain_previous_reading(${tenancy.id}::uuid, ${r.meter_type}) AS previous`;
      const own = ownRows[0]?.previous ?? null;

      if (own !== null) {
        const derived = Number(own);

        // A replaced or wrapped meter starts a new chain. The old dial is gone,
        // so there is nothing to derive from — but it is recorded, because this
        // is the one place a number lower than last month is legitimate.
        if (r.meter_replaced) {
          if (r.old_reading === undefined) {
            throw badRequest(`ต้องกรอกเลขเริ่มต้นของมิเตอร์${label}ตัวใหม่ โดยอ่านจากหน้ามิเตอร์จริง`);
          }
          await prisma.$executeRaw`
            INSERT INTO audit_log (entity_type, entity_id, action, detail, actor_id)
            VALUES ('meter', ${tenancy.room_id}::uuid, 'meter_replaced',
                    ${JSON.stringify({
                      meter_type: r.meter_type,
                      previous_chain_reading: derived,
                      new_baseline: r.old_reading,
                      reading_period,
                      tenancy_id: tenancy.id,
                    })}::jsonb,
                    ${req.user!.id}::uuid)`;
          resolvedOld.push(r.old_reading);
          continue;
        }

        // Continuing month: the chain decides, not the caller.
        if (r.old_reading !== undefined && r.old_reading !== derived) {
          throw conflict(
            `เลขครั้งก่อนของมิเตอร์${label}ต้องเป็น ${derived} (ตามที่บันทึกไว้เดือนก่อน) ` +
              `ไม่ใช่ ${r.old_reading} — ถ้าเปลี่ยนมิเตอร์ใหม่ ให้ระบุว่าเปลี่ยนมิเตอร์`,
          );
        }
        resolvedOld.push(derived);
      } else {
        // Opening reading: must come off the physical meter (ADR-008).
        if (r.old_reading === undefined) {
          throw badRequest(`ต้องกรอกเลขเริ่มต้นของมิเตอร์${label} โดยอ่านจากหน้ามิเตอร์จริง`);
        }

        // A genuinely previous occupant: anyone outside this renewal chain.
        // Scoped to `tenancy.room_id`, which after a transfer is the NEW room —
        // so the number staff are asked to reconcile against is the last person
        // to live in the room they are standing in.
        const priorRows = await prisma.$queryRaw<{ new_reading: string }[]>`
          SELECT new_reading FROM meter_readings
          WHERE room_id = ${tenancy.room_id}::uuid
            AND meter_type = ${r.meter_type}
            AND tenancy_id NOT IN (SELECT tenancy_id FROM tenancy_chain(${tenancy.id}::uuid))
          ORDER BY reading_period DESC, entered_at DESC LIMIT 1`;
        const priorClose = priorRows[0] ? Number(priorRows[0].new_reading) : undefined;

        if (priorClose !== undefined) {
          // §4.2: below the old closing value is a typo or a replaced meter.
          if (r.old_reading < priorClose) {
            throw conflict(
              `เลขเริ่มต้นของมิเตอร์${label} (${r.old_reading}) ต่ำกว่าเลขปิดของผู้เช่าคนก่อน ` +
                `(${priorClose}) — ตรวจสอบก่อนบันทึก`,
            );
          }
          // Higher means the meter ran between tenancies. That may be genuine
          // (the room was cleaned, a light was left on) but the gap is usage
          // nobody is being billed for, so it is confirmed rather than assumed.
          if (r.old_reading > priorClose && !r.confirm_opening) {
            throw conflict(
              `เลขเริ่มต้นของมิเตอร์${label} (${r.old_reading}) ไม่ตรงกับเลขปิดของผู้เช่าคนก่อน ` +
                `(${priorClose}) — ต่างกัน ${r.old_reading - priorClose} หน่วย กรุณายืนยัน`,
            );
          }
        }
        resolvedOld.push(r.old_reading);
      }
    }

    readings.forEach((r, i) => {
      // The schema's CHECK enforces this too; catching it here lets us name the
      // meter and the numbers instead of surfacing a constraint violation.
      //
      // NOTE: a rolled-over meter (9,998 → 0,012) legitimately reads lower, and
      // the schema cannot store it — CHECK (new_reading >= old_reading). On
      // 4-digit meters that is roughly a 5-year event, tracked as PROGRESS.md
      // open question 3, and it is not something to invent a representation for
      // here. Today it is rejected with a message a human can act on.
      if (r.new_reading < resolvedOld[i]!) {
        throw badRequest(
          `เลขมิเตอร์${r.meter_type === 'water' ? 'น้ำ' : 'ไฟ'}ครั้งนี้ (${r.new_reading}) ` +
            `น้อยกว่าครั้งก่อน (${resolvedOld[i]})`,
        );
      }
    });

    // The rate is captured per row so computed_cost is frozen against later
    // tariff changes: last rate effective on or before the billing period.
    const types = readings.map((r) => r.meter_type);
    const olds = resolvedOld;
    const news = readings.map((r) => r.new_reading);
    const estimated = readings.map((r) => r.is_estimated);

    try {
      const rows = await prisma.$queryRaw<
        { id: string; meter_type: string; computed_cost: string; rate: string; is_estimated: boolean }[]
      >`
        INSERT INTO meter_readings (tenancy_id, room_id, meter_type, reading_period,
                                    old_reading, new_reading, rate, is_estimated, entered_by)
        SELECT ${tenancy.id}::uuid, ${tenancy.room_id}::uuid, e.meter_type, ${reading_period}::date,
               e.old_reading, e.new_reading,
               (SELECT ur.rate FROM utility_rates ur
                 WHERE ur.meter_type = e.meter_type
                   AND ur.effective_from <= ${reading_period}::date
                 ORDER BY ur.effective_from DESC LIMIT 1),
               e.is_estimated, ${req.user!.id}::uuid
        FROM unnest(${types}::text[], ${olds}::numeric[], ${news}::numeric[], ${estimated}::boolean[])
             AS e(meter_type, old_reading, new_reading, is_estimated)
        RETURNING id, meter_type, computed_cost, rate, is_estimated`;

      res.status(201).json({ readings: rows });
    } catch (err) {
      // ADR-015: a duplicate anywhere in the batch fails the whole request, and
      // the message names which meter conflicted so the screen can show the
      // existing reading for that one without discarding the other.
      const which = readings.length === 1 ? (readings[0]!.meter_type === 'water' ? 'น้ำ' : 'ไฟ') : '';
      const mapped = fromDatabaseError(err, `มีเลขมิเตอร์${which}ของงวดนี้บันทึกไว้แล้ว`);
      throw mapped ?? err;
    }
  }),
);

const correctBody = z.object({
  corrected_old_reading: z.number().min(0),
  corrected_new_reading: z.number().min(0),
  reason: z.string().trim().min(1, 'ต้องระบุเหตุผลในการแก้ไข'),
});

/**
 * POST /meter-readings/:id/correct — admin only (S15).
 *
 * Writes to meter_reading_corrections and never mutates the original row:
 * ADR-006 makes that table append-only, and the original reading stays readable
 * beside the correction. A tenant who queries a bill can see what was changed
 * and why, which is the whole point of the audit trail.
 */
meterReadingRoutes.post(
  '/:id/correct',
  requireAuth,
  // Was admin-only. Rule 6 makes it a checkbox the owner may hand to one
  // trusted person, and an admin still passes without one.
  requirePermission('meter.correct'),
  asyncHandler(async (req, res) => {
    const parsed = correctBody.safeParse(req.body);
    if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ครบถ้วน');
    const c = parsed.data;

    if (c.corrected_new_reading < c.corrected_old_reading) {
      throw badRequest('เลขครั้งนี้ต้องไม่น้อยกว่าเลขครั้งก่อน');
    }

    const exists = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM meter_readings WHERE id = ${req.params.id}::uuid`;
    if (!exists[0]) throw notFound('ไม่พบรายการมิเตอร์นี้');

    const rows = await prisma.$queryRaw<{ id: string; corrected_at: Date }[]>`
      INSERT INTO meter_reading_corrections (meter_reading_id, corrected_old_reading,
                                             corrected_new_reading, reason, corrected_by)
      VALUES (${req.params.id}::uuid, ${c.corrected_old_reading}, ${c.corrected_new_reading},
              ${c.reason}, ${req.user!.id}::uuid)
      RETURNING id, corrected_at`;

    res.status(201).json({ correction: rows[0] });
  }),
);

/**
 * The batch sheet's data (S13): every active tenancy for a period, with what
 * each meter already has on file.
 *
 * `previous_reading` is derived here the same way POST derives it — the last
 * reading on this tenancy's own chain — so the number the screen shows locked
 * is the number the server will accept. It is deliberately NOT the previous
 * tenant's closing value: at move-in the field is blank with that value shown
 * only as a reference label (ADR-008), which is why `prior_tenant_close` is a
 * separate field and never fills the input.
 */
meterReadingRoutes.get(
  '/pending',
  requireAuth,
  requirePermission('meter.record', 'meter.correct'),
  asyncHandler(async (req, res) => {
    const period = z.string().date().safeParse(req.query.reading_period);
    if (!period.success) throw badRequest('ต้องระบุงวด (reading_period)');
    const p = period.data;

    const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT tn.id AS tenancy_id, r.room_number,
             -- Floor is the first digit of the room number (101–115 = floor 1);
             -- rooms has no floor column, and the dashboard derives it the same way.
             LEFT(r.room_number, 1)::int AS floor,
             t.full_name AS tenant_name,
             m.meter_type,
             prev.new_reading::float8 AS previous_reading,
             prior.new_reading::float8 AS prior_tenant_close,
             cur.id AS reading_id,
             cur.old_reading::float8 AS recorded_old,
             cur.new_reading::float8 AS recorded_new,
             cur.computed_cost::float8 AS recorded_cost,
             cur.is_estimated AS recorded_estimated
      FROM tenancies tn
      JOIN rooms r ON r.id = tn.room_id
      JOIN tenants t ON t.id = tn.tenant_id
      CROSS JOIN (VALUES ('electric'), ('water')) AS m(meter_type)
      -- The chain on this room, excluding this period's own row: that is what
      -- the entry endpoint sees when the month has not been recorded yet. The
      -- sheet and the endpoint MUST agree — a sheet that pre-fills one number
      -- and an endpoint that rejects anything but another is the worst of both
      -- — so both go through 012's function.
      LEFT JOIN LATERAL (
        SELECT chain_previous_reading(tn.id, m.meter_type, ${p}::date) AS new_reading
      ) prev ON TRUE
      LEFT JOIN LATERAL (
        SELECT mr.new_reading FROM meter_readings mr
        WHERE mr.room_id = tn.room_id AND mr.meter_type = m.meter_type
          AND mr.tenancy_id NOT IN (SELECT tenancy_id FROM tenancy_chain(tn.id))
        ORDER BY mr.reading_period DESC, mr.entered_at DESC LIMIT 1
      ) prior ON TRUE
      -- Room-scoped as well as tenancy-scoped. In a transfer month this
      -- contract has TWO rows for the same meter and period — the old room's
      -- closing, written at the moment of the move, and the new room's, still
      -- to come. Without the room filter the sheet would show the old room's
      -- finished reading and tell staff this room was already done.
      LEFT JOIN LATERAL (
        SELECT mr.id, mr.old_reading, mr.new_reading, mr.computed_cost, mr.is_estimated
        FROM meter_readings mr
        WHERE mr.tenancy_id = tn.id AND mr.meter_type = m.meter_type
          AND mr.reading_period = ${p}::date AND mr.room_id = tn.room_id
      ) cur ON TRUE
      WHERE tn.status = 'active'
      ORDER BY r.room_number, m.meter_type`;

    // One row per room, two meters inside it — the shape the sheet is walked in.
    const byTenancy = new Map<string, Record<string, unknown>>();
    for (const row of rows) {
      const id = String(row.tenancy_id);
      if (!byTenancy.has(id)) {
        byTenancy.set(id, {
          tenancy_id: id,
          room_number: row.room_number,
          floor: row.floor,
          tenant_name: row.tenant_name,
          meters: {},
        });
      }
      const entry = byTenancy.get(id)!;
      (entry.meters as Record<string, unknown>)[String(row.meter_type)] = {
        previous_reading: row.previous_reading,
        prior_tenant_close: row.prior_tenant_close,
        // No previous reading on this tenancy = the opening one, which ADR-008
        // says must be typed from the physical dial rather than pre-filled.
        is_opening: row.previous_reading === null,
        recorded: row.reading_id
          ? {
              id: row.reading_id,
              old_reading: row.recorded_old,
              new_reading: row.recorded_new,
              computed_cost: row.recorded_cost,
              is_estimated: row.recorded_estimated,
            }
          : null,
      };
    }

    const tenancies = [...byTenancy.values()];
    const done = tenancies.filter((t) =>
      Object.values(t.meters as Record<string, { recorded: unknown }>).every((m) => m.recorded),
    ).length;

    res.json({ reading_period: p, tenancies, total: tenancies.length, complete: done });
  }),
);

/** The reading, plus any corrections against it — the original is never hidden. */
meterReadingRoutes.get(
  '/:id',
  requireAuth,
  requirePermission('meter.record', 'meter.correct'),
  asyncHandler(async (req, res) => {
    const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT mr.id, mr.meter_type, mr.reading_period, mr.old_reading, mr.new_reading,
             mr.rate, mr.computed_cost, mr.is_estimated, mr.entered_at,
             COALESCE(
               (SELECT json_agg(json_build_object(
                  'corrected_old_reading', c.corrected_old_reading,
                  'corrected_new_reading', c.corrected_new_reading,
                  'reason', c.reason, 'corrected_at', c.corrected_at)
                  ORDER BY c.corrected_at)
                FROM meter_reading_corrections c WHERE c.meter_reading_id = mr.id),
               '[]'::json) AS corrections
      FROM meter_readings mr WHERE mr.id = ${req.params.id}::uuid`;

    if (!rows[0]) throw notFound('ไม่พบรายการมิเตอร์นี้');
    res.json({ reading: rows[0] });
  }),
);
