import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { asyncHandler } from '../http/asyncHandler.js';
import { badRequest, conflict, fromDatabaseError, notFound } from '../http/errors.js';
import { requireAuth, requirePermission, requireRole } from '../middleware/auth.js';
import { billIssuedNotice } from '../notify/emit.js';

export const invoiceRoutes = Router();
export const tenancyInvoiceRoutes = Router();

/**
 * The late fee, in SQL, in one place.
 *
 * ADR-009 / §3.8: live while the invoice is unpaid, frozen the moment a payment
 * is submitted — and the API chooses which number to show, the database just
 * stores both. Shown live and stored frozen must never disagree by construction,
 * which is why both readings come from this one expression.
 *
 * bangkok_today(), never CURRENT_DATE: Supabase's pooler is UTC, so for seven
 * hours a day CURRENT_DATE is yesterday and this would under-bill by one day —
 * then freeze that number onto a receipt permanently.
 */
export const LIVE_LATE_FEE = `
  (GREATEST(0, bangkok_today() - i.due_date)
   * (SELECT value::numeric FROM system_settings WHERE key = 'late_fee_per_day'))`;

/** What the tenant owes today: the frozen fee once one exists, else the live one. */
const EFFECTIVE_LATE_FEE = `COALESCE(i.late_fee_frozen, ${LIVE_LATE_FEE})`;

/**
 * Casts at the JSON boundary, not conversions in JS.
 *
 * invoice_number is BIGINT, which JSON.stringify throws on outright — the row
 * commits and the response dies, which is a confusing failure to debug. NUMERIC
 * arrives as a string, so money is cast too and the client gets numbers
 * throughout. The database keeps NUMERIC(10,2) and does all the arithmetic;
 * float8 appears only on the way out.
 */
export const INVOICE_COLUMNS = `
  i.id, i.invoice_number::text AS invoice_number, i.tenancy_id, i.billing_period,
  i.room_charge::float8 AS room_charge,
  i.utility_charge::float8 AS utility_charge,
  i.other_charges::float8 AS other_charges,
  i.total_amount::float8 AS total_amount,
  i.due_date, i.status,
  i.late_fee_frozen::float8 AS late_fee_frozen, i.generated_at,
  ${LIVE_LATE_FEE}::float8 AS late_fee_live,
  ${EFFECTIVE_LATE_FEE}::float8 AS late_fee_effective,
  (i.total_amount + ${EFFECTIVE_LATE_FEE})::float8 AS amount_due,
  (i.late_fee_frozen IS NOT NULL) AS late_fee_is_frozen,
  r.room_number, t.full_name AS tenant_name, t.phone AS tenant_phone`;

export const INVOICE_FROM = `
  FROM invoices i
  JOIN tenancies tn ON tn.id = i.tenancy_id
  JOIN rooms r ON r.id = tn.room_id
  JOIN tenants t ON t.id = tn.tenant_id`;

/**
 * Generate one invoice for a tenancy and period.
 *
 * ADR-015: both a water AND an electric reading must exist for the period. An
 * invoice built from one utility looks complete and is silently short — the
 * kind of error nobody finds until a tenant does.
 *
 * room_charge comes from tenancies.monthly_rent, never from the room's current
 * price (rule 2 — the rent is frozen for the contract's life).
 */
export async function generateInvoice(tenancyId: string, billingPeriod: string, userId: string) {
  // Completeness is per ROOM, not per contract (rule 13). A transfer month has
  // two rooms on one bill, and counting only meter types would call the month
  // done as soon as the old room was read — issuing a bill with nothing in it
  // for the room the tenant actually lives in. That under-charge becomes
  // permanent the moment a receipt exists, so it is checked before anything is
  // written rather than reconciled afterwards.
  const missingRows = await prisma.$queryRaw<
    { room_number: string; meter_type: string; rooms_in_period: number }[]
  >`
    SELECT r.room_number, m.meter_type,
           (SELECT count(*)::int
              FROM tenancy_rooms_in_period(${tenancyId}::uuid, ${billingPeriod}::date)) AS rooms_in_period
    FROM tenancy_rooms_in_period(${tenancyId}::uuid, ${billingPeriod}::date) AS tr(room_id)
    JOIN rooms r ON r.id = tr.room_id
    CROSS JOIN (VALUES ('electric'), ('water')) AS m(meter_type)
    WHERE NOT EXISTS (
      SELECT 1 FROM meter_readings mr
      WHERE mr.tenancy_id = ${tenancyId}::uuid
        AND mr.reading_period = ${billingPeriod}::date
        AND mr.room_id = tr.room_id
        AND mr.meter_type = m.meter_type
    )
    ORDER BY r.room_number, m.meter_type`;

  if (missingRows.length > 0) {
    // Name the room as well as the meter once a contract can span two of them:
    // "ยังไม่ได้จดมิเตอร์ไฟ" is not actionable when there are two electric
    // meters in play and one of them is done.
    const rooms = [...new Set(missingRows.map((m) => m.room_number))];
    const th = [...new Set(missingRows.map((m) => (m.meter_type === 'water' ? 'น้ำ' : 'ไฟ')))].join(' และ ');
    // Name the room whenever the contract spanned more than one this period —
    // not merely when more than one is still missing. In the common transfer
    // case exactly one room is outstanding, and that is precisely when staff
    // need telling which of the two it is.
    const where = (missingRows[0]!.rooms_in_period ?? 1) > 1 ? ` (ห้อง ${rooms.join(', ')})` : '';
    throw badRequest(`ยังไม่ได้จดมิเตอร์${th}ของงวดนี้${where} — ออกบิลไม่ได้`);
  }

  // The bill and the notice that it exists are ONE statement (Phase 1 of
  // docs/LINE_INTEGRATION_PLAN.md): Rule 6.13 makes the notification the proof
  // the tenant was told, and a proof written by a second query is a proof that
  // an error between the two can lose while the invoice stands.
  const rows = await prisma.$queryRaw<{ id: string; invoice_number: string; total_amount: number }[]>`
    WITH issued AS (
      INSERT INTO invoices (tenancy_id, billing_period, room_charge, utility_charge,
                            total_amount, due_date, generated_by)
      SELECT tn.id,
             ${billingPeriod}::date,
             tn.monthly_rent,
             u.utility_charge,
             tn.monthly_rent + u.utility_charge,
             -- Due on the owner's due_day of the month AFTER the billing period:
             -- July's bill is due 5 August, and the late fee starts on the 6th.
             (${billingPeriod}::date
               + INTERVAL '1 month'
               + ((SELECT value::int FROM system_settings WHERE key = 'due_day') - 1) * INTERVAL '1 day')::date,
             ${userId}::uuid
      FROM tenancies tn
      CROSS JOIN LATERAL (
        SELECT COALESCE(SUM(mr.computed_cost), 0) AS utility_charge
        FROM meter_readings mr
        WHERE mr.tenancy_id = tn.id AND mr.reading_period = ${billingPeriod}::date
      ) u
      WHERE tn.id = ${tenancyId}::uuid
      RETURNING id, invoice_number, tenancy_id, billing_period, total_amount, due_date
    ), ${billIssuedNotice({
      tenant: Prisma.sql`tn.tenant_id`,
      ref: Prisma.sql`issued.id`,
      room: Prisma.sql`r.room_number`,
      period: Prisma.sql`issued.billing_period`,
      // The bill as issued. The ฿50/day is not part of it yet and must not be:
      // ADR-009 computes it live until a payment freezes it.
      amount: Prisma.sql`issued.total_amount`,
      due: Prisma.sql`issued.due_date`,
      from: Prisma.sql`FROM issued
        JOIN tenancies tn ON tn.id = issued.tenancy_id
        JOIN rooms r ON r.id = tn.room_id`,
    })}
    SELECT id, invoice_number::text AS invoice_number, total_amount::float8 AS total_amount
    FROM issued`;

  return rows[0];
}

const generateBody = z.object({ billing_period: z.string().date() });

tenancyInvoiceRoutes.post(
  '/:id/invoices',
  requireAuth,
  requirePermission('invoice.generate'),
  asyncHandler(async (req, res) => {
    const parsed = generateBody.safeParse(req.body);
    if (!parsed.success) throw badRequest('ต้องระบุงวดบิล');

    const tenancy = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM tenancies WHERE id = ${req.params.id}::uuid`;
    if (!tenancy[0]) throw notFound('ไม่พบสัญญานี้');

    try {
      const invoice = await generateInvoice(req.params.id!, parsed.data.billing_period, req.user!.id);
      res.status(201).json({ invoice });
    } catch (err) {
      // UNIQUE (tenancy_id, billing_period): a double-submit or two staff
      // clicking at once gets a 409, never a second invoice for the same month.
      const mapped = fromDatabaseError(err, 'งวดนี้ออกบิลไปแล้ว');
      throw mapped ?? err;
    }
  }),
);

/**
 * S17's list: tenancies ready to bill for a period.
 *
 * "Ready" means BOTH utilities are on file (ADR-015). A tenancy with only one
 * reading is deliberately absent rather than listed-but-blocked — it belongs on
 * the meter-reading surface, and the two must not look identical to staff.
 */
invoiceRoutes.get(
  '/ready',
  requireAuth,
  requirePermission('invoice.generate'),
  asyncHandler(async (req, res) => {
    const period = z.string().date().safeParse(req.query.billing_period);
    if (!period.success) throw badRequest('ต้องระบุงวดบิล (billing_period)');

    const ready = await prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT tn.id AS tenancy_id, r.room_number, t.full_name AS tenant_name,
             tn.monthly_rent::float8 AS monthly_rent,
             SUM(mr.computed_cost)::float8 AS utility_charge,
             (tn.monthly_rent + SUM(mr.computed_cost))::float8 AS total_amount
      FROM tenancies tn
      JOIN rooms r ON r.id = tn.room_id
      JOIN tenants t ON t.id = tn.tenant_id
      JOIN meter_readings mr ON mr.tenancy_id = tn.id AND mr.reading_period = ${req.query.billing_period as string}::date
      WHERE tn.status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM invoices i
          WHERE i.tenancy_id = tn.id AND i.billing_period = ${req.query.billing_period as string}::date
        )
      GROUP BY tn.id, r.room_number, t.full_name, tn.monthly_rent
      -- Both meters in EVERY room the contract occupied this period, not two
      -- meter types anywhere. A transfer month otherwise appears here the
      -- moment the old room is read, and generateInvoice then refuses it —
      -- a list that offers work the next screen rejects is worse than a
      -- shorter list.
      HAVING COUNT(DISTINCT (mr.room_id, mr.meter_type))
             = 2 * (SELECT count(*) FROM tenancy_rooms_in_period(tn.id, ${req.query.billing_period as string}::date))
      ORDER BY r.room_number`;

    res.json({ billing_period: req.query.billing_period, ready, count: ready.length });
  }),
);

/**
 * The batch run (S17). Each invoice is generated independently so one blocked
 * tenancy cannot stop the other 59 — the response reports what was skipped and
 * why, rather than failing the whole month.
 */
invoiceRoutes.post(
  '/batch',
  requireAuth,
  requirePermission('invoice.generate'),
  asyncHandler(async (req, res) => {
    const parsed = generateBody.safeParse(req.body);
    if (!parsed.success) throw badRequest('ต้องระบุงวดบิล');
    const period = parsed.data.billing_period;

    const candidates = await prisma.$queryRaw<{ tenancy_id: string; room_number: string }[]>`
      SELECT tn.id AS tenancy_id, r.room_number
      FROM tenancies tn
      JOIN rooms r ON r.id = tn.room_id
      JOIN meter_readings mr ON mr.tenancy_id = tn.id AND mr.reading_period = ${period}::date
      WHERE tn.status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM invoices i WHERE i.tenancy_id = tn.id AND i.billing_period = ${period}::date
        )
      GROUP BY tn.id, r.room_number
      HAVING COUNT(DISTINCT mr.meter_type) = 2
      ORDER BY r.room_number`;

    const generated: { room_number: string; invoice_number: string }[] = [];
    const skipped: { room_number: string; reason: string }[] = [];

    for (const c of candidates) {
      try {
        const inv = await generateInvoice(c.tenancy_id, period, req.user!.id);
        generated.push({ room_number: c.room_number, invoice_number: String(inv?.invoice_number) });
      } catch (err) {
        const mapped = fromDatabaseError(err, 'งวดนี้ออกบิลไปแล้ว');
        skipped.push({
          room_number: c.room_number,
          reason: mapped?.message ?? (err instanceof Error ? err.message : 'ออกบิลไม่สำเร็จ'),
        });
      }
    }

    res.status(201).json({ billing_period: period, generated_count: generated.length, generated, skipped });
  }),
);

invoiceRoutes.get(
  '/',
  requireAuth,
  requirePermission('invoice.generate', 'payment.record'),
  asyncHandler(async (req, res) => {
    const tenancyId = typeof req.query.tenancy_id === 'string' ? req.query.tenancy_id : null;
    const status = typeof req.query.status === 'string' ? req.query.status : null;

    const invoices = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT ${INVOICE_COLUMNS} ${INVOICE_FROM}
       WHERE ($1::uuid IS NULL OR i.tenancy_id = $1::uuid)
         AND ($2::text IS NULL OR i.status = $2::text)
       ORDER BY i.invoice_number DESC`,
      tenancyId,
      status,
    );

    res.json({ invoices });
  }),
);

invoiceRoutes.get(
  '/:id',
  requireAuth,
  requirePermission('invoice.generate', 'payment.record'),
  asyncHandler(async (req, res) => {
    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT ${INVOICE_COLUMNS} ${INVOICE_FROM} WHERE i.id = $1::uuid`,
      req.params.id,
    );
    const invoice = rows[0];
    if (!invoice) throw notFound('ไม่พบบิลนี้');

    // The utility lines behind utility_charge, so a tenant querying the bill can
    // see the meter numbers rather than one lump sum (rule 7, tenant-visible).
    const lines = await prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT mr.meter_type, mr.old_reading::float8 AS old_reading, mr.new_reading::float8 AS new_reading,
             mr.rate::float8 AS rate, mr.computed_cost::float8 AS computed_cost, mr.is_estimated,
             -- Which room this line is FOR. In an ordinary month it is the one
             -- room and adds nothing; in a transfer month there are two of
             -- every meter (rule 13, Rule 10.3) and without the room number the
             -- bill shows two electric lines and no way to tell them apart.
             rm.room_number
      FROM meter_readings mr
      JOIN rooms rm ON rm.id = mr.room_id
      -- Matched inside the database rather than by round-tripping billing_period
      -- through JS, where a DATE becomes a Date at midnight UTC and stops
      -- matching the DATE column it came from.
      JOIN invoices i ON i.tenancy_id = mr.tenancy_id AND i.billing_period = mr.reading_period
      WHERE i.id = ${req.params.id}::uuid
      ORDER BY rm.room_number, mr.meter_type`;

    const history = await prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT old_status, new_status, reason, changed_at
      FROM invoice_status_history
      WHERE invoice_id = ${req.params.id}::uuid
      ORDER BY changed_at`;


    // The move itself, so a transfer month's two utility blocks can be labelled
    // with the dates they cover rather than just the room numbers. Empty for
    // every ordinary month, which is most of them.
    const transfers = await prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT h.transferred_on, fr.room_number AS from_room, tr.room_number AS to_room
      FROM tenancy_room_history h
      JOIN rooms fr ON fr.id = h.from_room_id
      JOIN rooms tr ON tr.id = h.to_room_id
      JOIN invoices i ON i.tenancy_id = h.tenancy_id
      WHERE i.id = ${req.params.id}::uuid
        AND h.transferred_on >= i.billing_period
        AND h.transferred_on < (i.billing_period + INTERVAL '1 month')::date
      ORDER BY h.transferred_on`;

    res.json({ invoice, utility_lines: lines, status_history: history, transfers });
  }),
);

/** ADR-005: financial fields are immutable. This is the adjustment path. */
invoiceRoutes.patch(
  '/:id',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async () => {
    throw conflict('บิลที่ออกแล้วแก้ไขไม่ได้ — ต้องออกรายการปรับปรุงแทน');
  }),
);
