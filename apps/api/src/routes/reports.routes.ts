import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { env } from '../env.js';
import { asyncHandler } from '../http/asyncHandler.js';
import { badRequest } from '../http/errors.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';

export const reportRoutes = Router();

/**
 * S39 + S40 — the money reports.
 *
 * One source: a **verified** payment. Money exists in this system at the moment
 * the owner approves a slip (ADR-007) and at no other moment — so nothing here
 * is typed, and there is no second record that could disagree with the first.
 * An unverified slip is not income; a generated invoice is not income either.
 *
 * The month a payment belongs to is the month it was VERIFIED, not the billing
 * period it settles. A tenant paying January's bill in March is March's income,
 * which is what the owner is reconciling against a bank statement.
 *
 * Every date is bucketed AT TIME ZONE 'Asia/Bangkok'. Casting a timestamptz to
 * a date on the pooled connection uses UTC, which moves every payment made
 * after 17:00 Bangkok into the previous day — and, for payments on the 1st, into
 * the previous month's total.
 */
const VERIFIED_MONTH = `date_trunc('month', (p.verified_at AT TIME ZONE 'Asia/Bangkok'))::date`;

/**
 * The category split comes from the invoice the payment settled, not from a
 * second set of columns on the payment. amount = total_amount + late_fee_frozen
 * by construction (rule 1 — an invoice settles in full), so these four parts sum
 * back to the payment exactly.
 *
 * Every one is COALESCEd: /summary aggregates a single month with no GROUP BY,
 * so a month with no verified slips yet returns one row of NULLs rather than no
 * row at all, and a NULL where the client expects a number is not "zero income"
 * — it is a crash on the screen that reads it.
 */
const CATEGORY_COLUMNS = `
  COALESCE(SUM(i.room_charge), 0)::float8                  AS rent,
  COALESCE(SUM(i.utility_charge), 0)::float8               AS utility,
  COALESCE(SUM(i.other_charges), 0)::float8                AS other,
  COALESCE(SUM(COALESCE(i.late_fee_frozen, 0)), 0)::float8 AS late_fee`;

reportRoutes.get(
  '/income',
  requireAuth,
  requirePermission('reports.view'),
  asyncHandler(async (req, res) => {
    const months = Math.min(Math.max(Number(req.query.months) || 6, 1), 24);

    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT ${VERIFIED_MONTH} AS month,
              COUNT(*)::int AS slip_count,
              SUM(p.amount)::float8 AS total,
              ${CATEGORY_COLUMNS},
              SUM(CASE WHEN p.payment_method = 'cash'     THEN p.amount ELSE 0 END)::float8 AS cash,
              SUM(CASE WHEN p.payment_method = 'transfer' THEN p.amount ELSE 0 END)::float8 AS transfer,
              SUM(CASE WHEN p.payment_method = 'qr'       THEN p.amount ELSE 0 END)::float8 AS qr
       FROM payments p
       JOIN invoices i ON i.id = p.invoice_id
       WHERE p.verified_at IS NOT NULL
         AND ${VERIFIED_MONTH} > date_trunc('month', bangkok_today()) - ($1::int - 1) * INTERVAL '1 month'
       GROUP BY 1
       ORDER BY 1`,
      months,
    );

    res.json({ months: rows });
  }),
);

/**
 * S39's table: the slips behind one month's figure.
 *
 * Nothing on this screen is editable, and there is no endpoint that would let
 * it be: a verified payment has produced a receipt in the tenant's hands
 * (rule 3). A wrong figure is corrected by fixing the bill, not the report.
 */
reportRoutes.get(
  '/income/detail',
  requireAuth,
  requirePermission('reports.view'),
  asyncHandler(async (req, res) => {
    const month = z.string().date().safeParse(req.query.month);
    if (!month.success) throw badRequest('ต้องระบุเดือน (month = วันที่ 1 ของเดือน)');

    const payments = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT p.id, p.amount::float8 AS amount, p.payment_method, p.verified_at,
              i.invoice_number::text AS invoice_number, i.billing_period,
              i.room_charge::float8 AS room_charge,
              i.utility_charge::float8 AS utility_charge,
              COALESCE(i.late_fee_frozen, 0)::float8 AS late_fee,
              r.room_number, t.full_name AS tenant_name,
              v.name AS verified_by_name, s.name AS submitted_by_name
       FROM payments p
       JOIN invoices i ON i.id = p.invoice_id
       JOIN tenancies tn ON tn.id = i.tenancy_id
       JOIN rooms r ON r.id = tn.room_id
       JOIN tenants t ON t.id = tn.tenant_id
       JOIN users v ON v.id = p.verified_by
       JOIN users s ON s.id = p.submitted_by
       WHERE p.verified_at IS NOT NULL AND ${VERIFIED_MONTH} = $1::date
       ORDER BY p.verified_at`,
      month.data,
    );

    // §15.4's reconciliation: who recorded and who confirmed, per month. ADR-007
    // is only a real control if someone can see it holding.
    const byStaff = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT v.name AS verified_by_name,
              COUNT(*)::int AS slip_count,
              SUM(p.amount)::float8 AS total,
              COUNT(*) FILTER (WHERE p.submitted_by = p.verified_by)::int AS self_recorded
       FROM payments p
       JOIN users v ON v.id = p.verified_by
       WHERE p.verified_at IS NOT NULL AND ${VERIFIED_MONTH} = $1::date
       GROUP BY v.name
       ORDER BY v.name`,
      month.data,
    );

    res.json({
      month: month.data,
      payments,
      total: payments.reduce((sum, p) => sum + Number(p.amount), 0),
      by_staff: byStaff,
    });
  }),
);

/**
 * S40's headline figures for one month.
 *
 * Occupancy is "right now", not month-end: it is read from active tenancies and
 * in-progress bookings, the same computation the room grid uses, because a
 * second definition of "occupied" is a second answer to the same question.
 */
reportRoutes.get(
  '/summary',
  requireAuth,
  requirePermission('reports.view'),
  asyncHandler(async (req, res) => {
    const month = z.string().date().safeParse(req.query.month);
    if (!month.success) throw badRequest('ต้องระบุเดือน');

    const income = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT COALESCE(SUM(p.amount), 0)::float8 AS total, COUNT(*)::int AS slip_count, ${CATEGORY_COLUMNS}
       FROM payments p JOIN invoices i ON i.id = p.invoice_id
       WHERE p.verified_at IS NOT NULL AND ${VERIFIED_MONTH} = $1::date`,
      month.data,
    );

    const billed = await prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT COUNT(*)::int AS invoice_count,
             COALESCE(SUM(total_amount), 0)::float8 AS billed_total,
             COUNT(*) FILTER (WHERE status = 'paid')::int AS paid_count,
             COUNT(*) FILTER (WHERE status = 'unpaid' AND due_date < bangkok_today())::int AS overdue_count,
             COALESCE(SUM(total_amount) FILTER (WHERE status <> 'paid'), 0)::float8 AS unpaid_total
      FROM invoices WHERE billing_period = ${month.data}::date`;

    const occupancy = await prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT COUNT(*)::int AS total_rooms,
             COUNT(*) FILTER (WHERE occupied)::int AS occupied_rooms
      FROM (
        SELECT r.id,
               (EXISTS (SELECT 1 FROM tenancies tn WHERE tn.room_id = r.id AND tn.status = 'active')
                OR EXISTS (SELECT 1 FROM bookings b WHERE b.room_id = r.id AND b.status = 'checked_in')) AS occupied
        FROM rooms r WHERE r.is_active
      ) x`;

    res.json({
      month: month.data,
      income: income[0],
      billing: billed[0],
      occupancy: occupancy[0],
    });
  }),
);

/**
 * S40 — how much of the LINE free tier this month has spent.
 *
 * Not money, but it belongs with the reports: it is the one running cost of the
 * notification channel, and the number a person needs before deciding whether
 * reminders may go over LINE as well as bills.
 *
 * Counted from the notifications themselves rather than from a counter, for the
 * same reason the money reports are: a second record could disagree with the
 * first. `sent` is the only state that spent a push — `skipped` never left the
 * process and `failed` was refused.
 */
reportRoutes.get(
  '/line-usage',
  requireAuth,
  requirePermission('reports.view'),
  asyncHandler(async (_req, res) => {
    const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT
        COUNT(*) FILTER (WHERE line_status = 'sent'
          AND (line_sent_at AT TIME ZONE 'Asia/Bangkok')::date
              >= date_trunc('month', bangkok_today())::date)::int AS used_this_month,
        COUNT(*) FILTER (WHERE line_status = 'pending')::int AS queued,
        COUNT(*) FILTER (WHERE line_status = 'failed')::int AS failed,
        COUNT(*) FILTER (WHERE line_status = 'skipped')::int AS skipped
      FROM notifications`;

    const linked = await prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT COUNT(*) FILTER (WHERE t.line_user_id IS NOT NULL)::int AS linked,
             COUNT(*)::int AS total
      FROM tenants t
      WHERE EXISTS (SELECT 1 FROM tenancies tn WHERE tn.tenant_id = t.id AND tn.status = 'active')`;

    res.json({
      usage: { ...rows[0], cap: env.LINE_MONTHLY_PUSH_CAP, configured: env.lineConfigured },
      tenants: linked[0],
    });
  }),
);
