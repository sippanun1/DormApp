import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { asyncHandler } from '../http/asyncHandler.js';
import { badRequest, conflict, fromDatabaseError, notFound } from '../http/errors.js';
import { requireAuth, requireRole, requirePermission } from '../middleware/auth.js';
import { generateInvoice, LIVE_LATE_FEE } from './invoices.routes.js';

export const checkoutRoutes = Router();

/**
 * S27 — move-out settlement (Rule 9.4, never-violate rule 4).
 *
 * The arithmetic is deliberately in one place and the floor is in the schema:
 * `deposit_settlements.refund_amount` is a generated column that cannot go
 * below zero, so no endpoint written later can invent a debt for someone who
 * has already left. What this file adds on top is the *inputs* — which bills
 * are still outstanding, what the owner's cleaning fee is today, and whether
 * the tenant is leaving before the term they agreed to (rule 12).
 */

/** Outstanding = anything not settled: unpaid, rejected, or a slip still in the queue. */
const OUTSTANDING_INVOICES = `
  SELECT i.id, i.invoice_number::text AS invoice_number, i.billing_period, i.status,
         i.total_amount::float8 AS total_amount,
         (i.total_amount + COALESCE(i.late_fee_frozen, ${LIVE_LATE_FEE}))::float8 AS amount_due
  FROM invoices i
  WHERE i.tenancy_id = $1::uuid AND i.status <> 'paid'
  ORDER BY i.billing_period`;

async function loadCheckout(tenancyId: string) {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT tn.id, tn.status, tn.start_date, tn.agreed_months,
           tn.monthly_rent::float8 AS monthly_rent,
           tn.deposit_amount::float8 AS deposit_amount,
           r.id AS room_id, r.room_number,
           t.full_name AS tenant_name, t.phone AS tenant_phone,
           (tn.start_date + (tn.agreed_months || ' months')::interval)::date AS agreed_until,
           -- Rule 12: early termination is measured against the agreed term,
           -- and bangkok_today() decides "early" — not the server's clock.
           ((tn.start_date + (tn.agreed_months || ' months')::interval)::date > bangkok_today()) AS is_early,
           ((tn.start_date + (tn.agreed_months || ' months')::interval)::date - bangkok_today()) AS days_remaining
    FROM tenancies tn
    JOIN rooms r ON r.id = tn.room_id
    JOIN tenants t ON t.id = tn.tenant_id
    WHERE tn.id = ${tenancyId}::uuid`;
  return rows[0];
}

/**
 * GET /tenancies/:id/checkout — everything the settlement screen needs, and
 * nothing it would have to compute itself.
 */
checkoutRoutes.get(
  '/:id/checkout',
  requireAuth,
  requirePermission('tenancy.manage'),
  asyncHandler(async (req, res) => {
    const tenancy = await loadCheckout(req.params.id!);
    if (!tenancy) throw notFound('ไม่พบสัญญานี้');

    const outstanding = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(OUTSTANDING_INVOICES, req.params.id);

    // The last reading on each meter, so the final one can be entered against
    // the chain rather than typed blind (ADR-008 — same derivation as S13).
    const meters = await prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT m.meter_type,
             last.new_reading::float8 AS previous_reading,
             last.reading_period AS previous_period,
             (SELECT ur.rate::float8 FROM utility_rates ur
              WHERE ur.meter_type = m.meter_type AND ur.effective_from <= bangkok_today()
              ORDER BY ur.effective_from DESC LIMIT 1) AS rate
      FROM (VALUES ('electric'), ('water')) AS m(meter_type)
      -- Across the renewal chain: a tenant who renewed twice and then moved
      -- out has one continuous meter history, not three.
      LEFT JOIN LATERAL (
        SELECT mr.new_reading, mr.reading_period FROM meter_readings mr
        WHERE mr.tenancy_id IN (SELECT tenancy_id FROM tenancy_chain(${req.params.id}::uuid))
          AND mr.meter_type = m.meter_type
        ORDER BY mr.reading_period DESC, mr.entered_at DESC LIMIT 1
      ) last ON TRUE`;

    const policy = await prisma.$queryRaw<{ key: string; value: string }[]>`
      SELECT key, value FROM system_settings WHERE key IN ('cleaning_fee', 'late_fee_per_day')`;

    const settled = await prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT id, deposit_amount::float8 AS deposit_amount,
             cleaning_fee::float8 AS cleaning_fee,
             damage_amount::float8 AS damage_amount,
             outstanding_amount::float8 AS outstanding_amount,
             deposit_forfeited, forfeit_reason,
             refund_amount::float8 AS refund_amount,
             excess_waived::float8 AS excess_waived,
             notes, settled_at
      FROM deposit_settlements WHERE tenancy_id = ${req.params.id}::uuid`;

    res.json({
      tenancy,
      outstanding,
      outstanding_total: outstanding.reduce((sum, i) => sum + Number(i.amount_due), 0),
      meters,
      policy: Object.fromEntries(policy.map((p) => [p.key, Number(p.value)])),
      // Present when this tenancy has already been settled: the screen shows the
      // record rather than offering to settle a second time.
      settlement: settled[0] ?? null,
    });
  }),
);

const checkoutBody = z.object({
  end_date: z.string().date().optional(),
  damage_amount: z.number().min(0).default(0),
  /** Defaults to the owner's policy; staff may raise it for heavy dirt (Rule 9.3). */
  cleaning_fee: z.number().min(0).optional(),
  forfeit_deposit: z.boolean().default(false),
  forfeit_reason: z.string().trim().min(1).optional(),
  /** The final month's readings, if they are being taken at the door. */
  final_readings: z
    .array(
      z.object({
        meter_type: z.enum(['electric', 'water']),
        new_reading: z.number().min(0),
        is_estimated: z.boolean().default(false),
      }),
    )
    .max(2)
    .optional(),
  final_billing_period: z.string().date().optional(),
  notes: z.string().trim().optional(),
});

/**
 * POST /tenancies/:id/checkout — settle and close, in that order.
 *
 * Order matters and is not arbitrary: the final readings are recorded, the
 * final invoice is generated from them, and only then is "outstanding" read —
 * so the last month's bill is part of the settlement rather than a debt that
 * appears the moment the tenant is out the door.
 *
 * The tenancy is ended in the same statement that writes the settlement. A
 * settled deposit with the contract still active, or a closed contract with no
 * settlement, are both states nobody could explain afterwards.
 */
checkoutRoutes.post(
  '/:id/checkout',
  requireAuth,
  requirePermission('tenancy.manage'),
  asyncHandler(async (req, res) => {
    const parsed = checkoutBody.safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'ข้อมูลย้ายออกไม่ครบถ้วน');
    const body = parsed.data;

    const tenancy = await loadCheckout(req.params.id!);
    if (!tenancy) throw notFound('ไม่พบสัญญานี้');
    if (tenancy.status !== 'active') throw conflict('สัญญานี้ปิดไปแล้ว');

    // Rule 12 / Rule 4.12: forfeiting is a decision with a reason, never a
    // silent zero — and it only applies while the agreed term still has time
    // left on it. Forfeiting a completed contract would be taking money for
    // nothing, so the server refuses it rather than trusting the screen.
    if (body.forfeit_deposit) {
      if (!body.forfeit_reason) throw badRequest('ต้องระบุเหตุผลในการริบเงินประกัน');
      if (!tenancy.is_early) throw conflict('สัญญาครบกำหนดแล้ว — ริบเงินประกันไม่ได้');
    }

    // 1. The final readings.
    //
    // This does NOT go through POST /tenancies/:id/meter-readings, and the one
    // rule that matters is kept identical rather than assumed: the opening
    // value is derived from the chain in SQL and is never accepted from the
    // caller, so a move-out reading cannot start from a number somebody typed.
    // The move-in cases that endpoint handles (ADR-008's opening reading,
    // confirm_opening, meter_replaced) cannot arise at a move-out — there is
    // always a chain by then — which is why the simpler path is safe here.
    if (body.final_readings?.length) {
      const period = body.final_billing_period ?? null;
      if (!period) throw badRequest('ต้องระบุงวดของมิเตอร์ครั้งสุดท้าย');
      try {
        await prisma.$executeRawUnsafe(
          `INSERT INTO meter_readings (tenancy_id, room_id, meter_type, reading_period,
                                       old_reading, new_reading, rate, is_estimated, entered_by)
           SELECT $1::uuid, $2::uuid, e.meter_type, $3::date,
                  -- The chain decides the opening value, exactly as it does on
                  -- S13: the caller never sends one, so it cannot disagree.
                  COALESCE((SELECT mr.new_reading FROM meter_readings mr
                            WHERE mr.tenancy_id IN (SELECT tenancy_id FROM tenancy_chain($1::uuid))
                              AND mr.meter_type = e.meter_type
                            ORDER BY mr.reading_period DESC, mr.entered_at DESC LIMIT 1), 0),
                  e.new_reading,
                  (SELECT ur.rate FROM utility_rates ur
                   WHERE ur.meter_type = e.meter_type AND ur.effective_from <= $3::date
                   ORDER BY ur.effective_from DESC LIMIT 1),
                  e.is_estimated, $4::uuid
           FROM unnest($5::text[], $6::numeric[], $7::boolean[])
                AS e(meter_type, new_reading, is_estimated)`,
          req.params.id,
          tenancy.room_id,
          period,
          req.user!.id,
          body.final_readings.map((r) => r.meter_type),
          body.final_readings.map((r) => r.new_reading),
          body.final_readings.map((r) => r.is_estimated),
        );
      } catch (err) {
        // CHECK (new_reading >= old_reading) and the period UNIQUE both land here.
        const mapped = fromDatabaseError(err, 'บันทึกมิเตอร์ครั้งสุดท้ายไม่ได้ — ตรวจสอบเลขที่อ่านได้และงวด');
        throw mapped ?? err;
      }

      // 2. The final bill, from those readings. Skipped silently if the period
      // was already billed — a re-run of a half-finished checkout must not fail
      // on its own earlier work.
      try {
        await generateInvoice(req.params.id!, period, req.user!.id);
      } catch (err) {
        const mapped = fromDatabaseError(err, '');
        if (!mapped) throw err;
      }
    }

    // 3. Now read what is owed, with the final bill included.
    const outstanding = await prisma.$queryRawUnsafe<{ amount_due: number }[]>(OUTSTANDING_INVOICES, req.params.id);
    const outstandingTotal = outstanding.reduce((sum, i) => sum + Number(i.amount_due), 0);

    const cleaningRows = await prisma.$queryRaw<{ value: string }[]>`
      SELECT value FROM system_settings WHERE key = 'cleaning_fee'`;
    const cleaningFee = body.cleaning_fee ?? Number(cleaningRows[0]?.value ?? 0);

    // 4. Settle and close together.
    try {
      const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
        WITH closed AS (
          UPDATE tenancies
          SET status = 'ended',
              -- GREATEST(start_date, …): a renewal signed in advance is active
              -- before it begins (the partial unique index allows one active
              -- contract per room, so the old one closes at signing). Settling
              -- such a contract today would write an end date before its start
              -- and trip CHECK (end_date >= start_date). A contract that ends
              -- before it begins ends on the day it began.
              end_date = GREATEST(start_date,
                                  COALESCE(${body.end_date ?? null}::date, bangkok_today()))
          WHERE id = ${req.params.id}::uuid AND status = 'active'
          RETURNING id, deposit_amount, end_date
        ), settled AS (
          INSERT INTO deposit_settlements (tenancy_id, deposit_amount, cleaning_fee, damage_amount,
                                           outstanding_amount, deposit_forfeited, forfeit_reason,
                                           notes, settled_by)
          SELECT closed.id, closed.deposit_amount, ${cleaningFee}, ${body.damage_amount},
                 ${outstandingTotal}, ${body.forfeit_deposit}, ${body.forfeit_reason ?? null},
                 ${body.notes ?? null}, ${req.user!.id}::uuid
          FROM closed
          RETURNING tenancy_id, deposit_amount::float8 AS deposit_amount,
                    cleaning_fee::float8 AS cleaning_fee,
                    damage_amount::float8 AS damage_amount,
                    outstanding_amount::float8 AS outstanding_amount,
                    deposit_forfeited, forfeit_reason,
                    refund_amount::float8 AS refund_amount,
                    excess_waived::float8 AS excess_waived, settled_at
        )
        SELECT settled.*, closed.end_date FROM settled JOIN closed ON closed.id = settled.tenancy_id`;

      if (!rows[0]) throw conflict('ปิดสัญญาไม่ได้ — สัญญานี้ถูกปิดไปแล้ว');

      res.status(201).json({ settlement: rows[0], outstanding_invoices: outstanding.length });
    } catch (err) {
      // UNIQUE (tenancy_id) on deposit_settlements: a double-submit settles once.
      const mapped = fromDatabaseError(err, 'สัญญานี้คิดยอดย้ายออกไปแล้ว');
      throw mapped ?? err;
    }
  }),
);
