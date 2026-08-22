import { Router } from 'express';
import { Prisma } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { asyncHandler } from '../http/asyncHandler.js';
import { badRequest, conflict, fromDatabaseError, notFound } from '../http/errors.js';
import { requireAuth, requirePermission, requireRole } from '../middleware/auth.js';
import { env } from '../env.js';
import { isStoredSlipPath, signedSlipUrl, storeSlip } from '../storage/slips.js';
import { LIVE_LATE_FEE } from './invoices.routes.js';
import { paymentRejectedNotice, paymentVerifiedNotice } from '../notify/emit.js';

/** Mounted on /invoices — submission hangs off the invoice being settled. */
export const invoicePaymentRoutes = Router();
/** Mounted on /payments — the queue, the slip, verify and reject. */
export const paymentRoutes = Router();

/**
 * Held in memory, never written to disk. Nothing untrusted touches the
 * filesystem, and the bytes are sniffed before they reach storage.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.UPLOAD_MAX_SIZE, files: 1 },
});

/**
 * Multer throws its own error class, which the generic handler would report as
 * a 500 — "the system is broken" for what is a fixable field problem (E12).
 * Over-size is the one the tenant actually hits: a modern phone photo is bigger
 * than 5MB more often than not.
 */
const receiveSlip = (req: Request, res: Response, next: NextFunction): void => {
  upload.single('slip')(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      const mb = Math.round(env.UPLOAD_MAX_SIZE / 1024 / 1024);
      return next(
        badRequest(
          err.code === 'LIMIT_FILE_SIZE' ? `ไฟล์สลิปต้องไม่เกิน ${mb}MB` : 'อัปโหลดไฟล์สลิปไม่สำเร็จ',
        ),
      );
    }
    next(err);
  });
};

const PAYMENT_COLUMNS = `
  p.id, p.invoice_id, p.amount::float8 AS amount, p.payment_method,
  p.slip_file_url, p.submitted_by, p.submitted_at,
  p.verified_by, p.verified_at,
  -- payments has no status column (State Model §4): verification state IS these
  -- two fields, so anything that looks like a badge must derive from them.
  (p.verified_at IS NOT NULL) AS is_verified,
  su.name AS submitted_by_name, vu.name AS verified_by_name`;

const PAYMENT_FROM = `
  FROM payments p
  JOIN users su ON su.id = p.submitted_by
  LEFT JOIN users vu ON vu.id = p.verified_by`;

/**
 * Slip upload (S20), step one of two.
 *
 * Returns a storage path, not a URL: the caller passes it back as
 * `slip_file_url` when submitting the payment. Two steps rather than one
 * multipart submission because §5 specifies the payment body as JSON, and
 * because a failed upload should be re-tried on its own field (E12) without
 * losing the amount the staff member already typed.
 */
paymentRoutes.post(
  '/slips',
  requireAuth,
  requirePermission('payment.record'),
  receiveSlip,
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest('ไม่พบไฟล์สลิป');
    const stored = await storeSlip(req.file.buffer);
    res.status(201).json({ slip_file_url: stored.path, mime_type: stored.mime });
  }),
);

const submitBody = z.object({
  amount: z.number().positive(),
  payment_method: z.enum(['cash', 'transfer', 'qr'], {
    errorMap: () => ({ message: 'ต้องระบุวิธีชำระเงิน (เงินสด / โอน / QR)' }),
  }),
  slip_file_url: z.string().optional(),
});

/**
 * POST /invoices/:id/payments — §5, ADR-009.
 *
 * Three rules meet in one statement, which is why it is one statement:
 *
 * 1. **No partial payments** (rule 1). The amount must equal what is owed
 *    today, to the satang, and the comparison happens inside the UPDATE — a
 *    read-then-write would compare against a fee that can tick over one day at
 *    midnight between the two.
 * 2. **The late fee freezes here**, at submission, not at verification
 *    (ADR-009, corrected wording). From this moment the tenant's slip and the
 *    system agree on the number for good.
 * 3. The status move is recorded in `invoice_status_history` in the same
 *    statement — that table is append-only (ADR-006) and is the only trail a
 *    dispute has.
 */
invoicePaymentRoutes.post(
  '/:id/payments',
  requireAuth,
  requirePermission('payment.record'),
  asyncHandler(async (req, res) => {
    const parsed = submitBody.safeParse(req.body);
    if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'ข้อมูลการชำระเงินไม่ครบถ้วน');
    const { amount, payment_method, slip_file_url } = parsed.data;

    // Owner decision (§5): a slip is required for transfer and QR, optional for
    // cash — cash has nothing to photograph, and ADR-007's recorder ≠ verifier
    // separation is what stands in for the document there.
    if (payment_method !== 'cash' && !slip_file_url) throw badRequest('ต้องแนบสลิปสำหรับการโอนและ QR');
    if (slip_file_url && !isStoredSlipPath(slip_file_url)) {
      // Only a path this server produced is accepted: the column feeds a signed
      // URL later, and an arbitrary string there is somebody else's storage.
      throw badRequest('ไฟล์สลิปไม่ถูกต้อง — กรุณาอัปโหลดใหม่');
    }

    // Read first, but only to say WHY: the write below re-checks everything it
    // depends on, so a status that changes in between loses the race safely.
    const current = await prisma.$queryRawUnsafe<
      { status: string; amount_due: number; invoice_number: string }[]
    >(
      `SELECT i.status, i.invoice_number::text AS invoice_number,
              (i.total_amount + COALESCE(i.late_fee_frozen, ${LIVE_LATE_FEE}))::float8 AS amount_due
       FROM invoices i WHERE i.id = $1::uuid`,
      req.params.id,
    );
    const invoice = current[0];
    if (!invoice) throw notFound('ไม่พบบิลนี้');
    if (invoice.status === 'paid') throw conflict('บิลนี้ชำระแล้ว');
    if (invoice.status === 'pending_verification') throw conflict('บิลนี้มีสลิปรอตรวจสอบอยู่แล้ว');
    if (amount !== invoice.amount_due) {
      // Rule 1, stated as the amount to pay rather than as a refusal — staff
      // need the number, not the policy.
      throw badRequest(
        `ระบบไม่รับชำระบางส่วน — ต้องชำระเต็มจำนวน ฿${invoice.amount_due.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
      );
    }

    try {
      const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        `WITH target AS (
           SELECT i.id, i.status AS old_status,
                  COALESCE(i.late_fee_frozen, ${LIVE_LATE_FEE}) AS fee
           FROM invoices i WHERE i.id = $1::uuid
         ), frozen AS (
           UPDATE invoices i
           SET late_fee_frozen = t.fee, status = 'pending_verification'
           FROM target t
           WHERE i.id = t.id
             AND i.status IN ('unpaid', 'rejected')
             AND (i.total_amount + t.fee) = $2::numeric
           RETURNING i.id, t.old_status,
                     i.late_fee_frozen::float8 AS late_fee_frozen,
                     (i.total_amount + i.late_fee_frozen)::float8 AS amount_due
         ), paid AS (
           INSERT INTO payments (invoice_id, amount, payment_method, slip_file_url, submitted_by)
           SELECT f.id, $2::numeric, $3::text, $4::text, $5::uuid FROM frozen f
           RETURNING id, invoice_id, amount::float8 AS amount, payment_method,
                     slip_file_url, submitted_at
         ), hist AS (
           INSERT INTO invoice_status_history (invoice_id, old_status, new_status, changed_by)
           SELECT f.id, f.old_status, 'pending_verification', $5::uuid FROM frozen f
           RETURNING invoice_id
         )
         SELECT p.id, p.invoice_id, p.amount, p.payment_method, p.slip_file_url,
                p.submitted_at, f.late_fee_frozen, f.amount_due
         FROM paid p
         JOIN frozen f ON f.id = p.invoice_id
         JOIN hist h ON h.invoice_id = p.invoice_id`,
        req.params.id,
        String(amount),
        payment_method,
        slip_file_url ?? null,
        req.user!.id,
      );

      // Nothing back means the invoice moved between the read and the write.
      if (!rows[0]) throw conflict('สถานะบิลเปลี่ยนไปแล้ว — กรุณาเปิดบิลใหม่อีกครั้ง');
      res.status(201).json({ payment: rows[0] });
    } catch (err) {
      const mapped = fromDatabaseError(err, 'บันทึกการชำระเงินไม่สำเร็จ');
      throw mapped ?? err;
    }
  }),
);

/** Payments recorded against one invoice, including rejected attempts (S19). */
invoicePaymentRoutes.get(
  '/:id/payments',
  requireAuth,
  requirePermission('payment.record', 'invoice.generate'),
  asyncHandler(async (req, res) => {
    const payments = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT ${PAYMENT_COLUMNS} ${PAYMENT_FROM}
       WHERE p.invoice_id = $1::uuid ORDER BY p.submitted_at`,
      req.params.id,
    );
    res.json({ payments });
  }),
);

/**
 * S21, the verification queue: admin only, oldest first.
 *
 * `days_waiting` is computed AT TIME ZONE 'Asia/Bangkok' rather than by casting
 * a timestamptz straight to a date — the pooled connection is UTC, so the plain
 * cast is a day behind for seven hours of every day and the badge that is meant
 * to make an old slip visible would under-count it.
 */
paymentRoutes.get(
  '/pending',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (_req, res) => {
    const pending = await prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT p.id, p.invoice_id, p.amount::float8 AS amount, p.payment_method,
             p.submitted_at, su.name AS submitted_by_name,
             (p.slip_file_url IS NOT NULL) AS has_slip,
             (bangkok_today() - (p.submitted_at AT TIME ZONE 'Asia/Bangkok')::date) AS days_waiting,
             i.invoice_number::text AS invoice_number, i.billing_period,
             i.total_amount::float8 AS total_amount,
             i.late_fee_frozen::float8 AS late_fee_frozen,
             r.room_number, t.full_name AS tenant_name
      FROM payments p
      JOIN users su ON su.id = p.submitted_by
      JOIN invoices i ON i.id = p.invoice_id
      JOIN tenancies tn ON tn.id = i.tenancy_id
      JOIN rooms r ON r.id = tn.room_id
      JOIN tenants t ON t.id = tn.tenant_id
      WHERE p.verified_at IS NULL AND i.status = 'pending_verification'
      ORDER BY p.submitted_at`;

    res.json({ pending, count: pending.length });
  }),
);

/** S22. The slip is the screen's centrepiece, so the signed URL ships with it. */
paymentRoutes.get(
  '/:id',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT ${PAYMENT_COLUMNS},
              i.invoice_number::text AS invoice_number, i.status AS invoice_status,
              i.billing_period, i.total_amount::float8 AS total_amount,
              i.late_fee_frozen::float8 AS late_fee_frozen,
              (i.total_amount + COALESCE(i.late_fee_frozen, 0))::float8 AS amount_due,
              r.room_number, t.full_name AS tenant_name, t.phone AS tenant_phone
       ${PAYMENT_FROM}
       JOIN invoices i ON i.id = p.invoice_id
       JOIN tenancies tn ON tn.id = i.tenancy_id
       JOIN rooms r ON r.id = tn.room_id
       JOIN tenants t ON t.id = tn.tenant_id
       WHERE p.id = $1::uuid`,
      req.params.id,
    );
    const payment = rows[0];
    if (!payment) throw notFound('ไม่พบรายการชำระเงินนี้');

    const path = payment.slip_file_url;
    const slip_url = typeof path === 'string' ? await signedSlipUrl(path) : null;

    res.json({ payment, slip_url });
  }),
);

/**
 * ADR-007. Admin only here, and again in `trg_enforce_admin_verification` —
 * neither check is allowed to be the only one, and a staff token that reaches
 * the database directly is still refused by it.
 */
paymentRoutes.post(
  '/:id/verify',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
      WITH verified AS (
        UPDATE payments SET verified_by = ${req.user!.id}::uuid, verified_at = now()
        WHERE id = ${req.params.id}::uuid AND verified_at IS NULL
        RETURNING id, invoice_id, verified_at
      ), inv AS (
        UPDATE invoices i SET status = 'paid'
        FROM verified v
        WHERE i.id = v.invoice_id AND i.status = 'pending_verification'
        RETURNING i.id
      ), hist AS (
        INSERT INTO invoice_status_history (invoice_id, old_status, new_status, changed_by)
        SELECT inv.id, 'pending_verification', 'paid', ${req.user!.id}::uuid FROM inv
        RETURNING invoice_id
      ), ${paymentVerifiedNotice({
        tenant: Prisma.sql`tn.tenant_id`,
        // The payment, not the invoice: this notice is about the slip being
        // accepted, and the same invoice can carry a rejected slip before it.
        ref: Prisma.sql`v.id`,
        room: Prisma.sql`r.room_number`,
        period: Prisma.sql`i.billing_period`,
        // What was actually settled — ADR-009's frozen late fee included,
        // because that is the figure on the receipt.
        amount: Prisma.sql`(i.total_amount + COALESCE(i.late_fee_frozen, 0))`,
        // Joined through `inv`, exactly like the SELECT below: if the invoice
        // was not the one still awaiting verification, nothing happened and
        // nobody is told. `invoices i` reads the pre-UPDATE snapshot, which is
        // what we want — neither figure is changed by the status write.
        from: Prisma.sql`FROM verified v
          JOIN inv ON inv.id = v.invoice_id
          JOIN invoices i ON i.id = v.invoice_id
          JOIN tenancies tn ON tn.id = i.tenancy_id
          JOIN rooms r ON r.id = tn.room_id`,
      })}
      SELECT v.id, v.invoice_id, v.verified_at FROM verified v
      JOIN inv ON inv.id = v.invoice_id
      JOIN hist ON hist.invoice_id = v.invoice_id`;

    // Either the payment is already verified, or its invoice is no longer
    // awaiting verification — both mean somebody got here first.
    if (!rows[0]) throw conflict('ตรวจสอบไม่ได้ — รายการนี้ถูกดำเนินการไปแล้ว');
    res.json({ payment: rows[0] });
  }),
);

const rejectBody = z.object({ reason: z.string().trim().min(1) });

/**
 * Reject (S23). The reason is mandatory — a rejected slip with no reason is
 * indistinguishable from a mistake, and this row is what a "I did pay" dispute
 * is settled from. The payments row and its slip are kept, never deleted.
 *
 * `late_fee_frozen` is cleared back to NULL, which ADR-009 does not cover
 * because it only describes submission and verification. The bill is unpaid
 * again and the fee has to keep running: leaving the freeze in place would let
 * anyone stop the ฿50/day clock on the 6th by submitting a slip that is then
 * rejected. Nothing is rewritten retroactively — no receipt exists for a
 * rejected payment (rule 3), and the frozen figure is recorded in the payment
 * row's own `amount` regardless.
 */
paymentRoutes.post(
  '/:id/reject',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const parsed = rejectBody.safeParse(req.body);
    if (!parsed.success) throw badRequest('ต้องระบุเหตุผลที่ปฏิเสธสลิป');

    const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
      WITH target AS (
        SELECT p.id, p.invoice_id FROM payments p
        WHERE p.id = ${req.params.id}::uuid AND p.verified_at IS NULL
      ), inv AS (
        UPDATE invoices i SET status = 'rejected', late_fee_frozen = NULL
        FROM target t
        WHERE i.id = t.invoice_id AND i.status = 'pending_verification'
        RETURNING i.id
      ), hist AS (
        INSERT INTO invoice_status_history (invoice_id, old_status, new_status, reason, changed_by)
        SELECT inv.id, 'pending_verification', 'rejected', ${parsed.data.reason}, ${req.user!.id}::uuid
        FROM inv
        RETURNING invoice_id
      ), ${paymentRejectedNotice({
        tenant: Prisma.sql`tn.tenant_id`,
        ref: Prisma.sql`t.id`,
        room: Prisma.sql`r.room_number`,
        period: Prisma.sql`i.billing_period`,
        // The reason is mandatory here for the same purpose it is mandatory in
        // the history row: it is what a "I did pay" dispute is settled from,
        // and the tenant has to be able to read it. Rule 15 keeps it off LINE
        // (LINE_CARRIES excludes this event) — the app is the record.
        reason: Prisma.sql`${parsed.data.reason}`,
        from: Prisma.sql`FROM target t
          JOIN inv ON inv.id = t.invoice_id
          JOIN invoices i ON i.id = t.invoice_id
          JOIN tenancies tn ON tn.id = i.tenancy_id
          JOIN rooms r ON r.id = tn.room_id`,
      })}
      SELECT t.id, t.invoice_id FROM target t
      JOIN inv ON inv.id = t.invoice_id
      JOIN hist ON hist.invoice_id = t.invoice_id`;

    if (!rows[0]) throw conflict('ปฏิเสธไม่ได้ — รายการนี้ถูกดำเนินการไปแล้ว');
    res.json({ payment: rows[0], reason: parsed.data.reason });
  }),
);
