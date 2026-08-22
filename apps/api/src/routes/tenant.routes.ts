import { Prisma } from '@prisma/client';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { recordAudit } from '../db/audit.js';
import { prisma } from '../db/prisma.js';
import { env } from '../env.js';
import { asyncHandler } from '../http/asyncHandler.js';
import { badRequest, notFound } from '../http/errors.js';
import { requireAuth, requirePermission, requireTenant, signTenantToken } from '../middleware/auth.js';
import { claimLinkCode, CODE_LENGTH, generateCode, linkCodeWindowDays } from '../tenant/link-codes.js';
import { INVOICE_COLUMNS, INVOICE_FROM } from './invoices.routes.js';

/** Staff-side: issuing the code. Mounted under /tenants. */
export const tenantLinkRoutes = Router();
/** Tenant-side: everything a tenant token can reach. Mounted under /tenant. */
export const tenantAppRoutes = Router();

/**
 * Phase 2 of docs/LINE_INTEGRATION_PLAN.md — tenant identity.
 *
 * The identity proof is a code handed over at the desk (owner decision
 * 2026-08-17): staff issue it to a tenant they can see, the tenant types it
 * once, and the session it grants lasts a month. No SMS provider and no
 * password — `tenants` has no `password_hash` and deliberately gains none in
 * migration 010, because a password is a credential the office would end up
 * resetting over the phone, which is this same trust with worse storage.
 *
 * Every route below is READ-ONLY except redeeming a code and marking a
 * notification read. A tenant token cannot move money, and that is a property
 * of what is mounted here, not of a permission check.
 */

/**
 * The four staff-side link-code actions (S04 and S44): issue, extend, revoke,
 * and read the state back.
 *
 * All four require `tenancy.manage`, none is owner-only. Handing someone access
 * to a tenant's bills is the same class of act as putting them in a room, and
 * the person at the desk is the one who can see who they are talking to — which
 * is the entire security model here. Revoking is strictly less dangerous than
 * issuing, so gating it harder than the thing it undoes would only mean a stale
 * code stays live while someone looks for the owner.
 *
 * Each one writes `audit_log`: "who let this device in" has to stay answerable,
 * which is also why `issued_by` is NOT NULL RESTRICT in migration 010.
 */

/** How long a code lives, and never past the end of the tenancy it opens. */
const CODE_EXPIRY = (tenantId: string, days: number) => Prisma.sql`
  LEAST(
    now() + (${days}::text || ' days')::interval,
    -- 011's horizon: the agreed term for a monthly contract, the checkout date
    -- for a booking, NULL for a tenant between contracts (no cap, and the
    -- window above is then the only limit).
    COALESCE(
      (tenant_access_horizon(${tenantId}::uuid) + 1)::timestamp AT TIME ZONE 'Asia/Bangkok',
      'infinity'::timestamptz
    )
  )`;

/** The one live code for a tenant, if there is one. Used, unused — only revoked or expired ends it. */
const LIVE_CODE = Prisma.sql`revoked_at IS NULL AND expires_at > now()`;

tenantLinkRoutes.post(
  '/:id/link-code',
  requireAuth,
  requirePermission('tenancy.manage'),
  asyncHandler(async (req, res) => {
    const tenantId = String(req.params.id);
    const tenants = await prisma.$queryRaw<
      { id: string; full_name: string; contract_ended: boolean }[]
    >`
      SELECT id, full_name,
             -- Not "has no horizon": a tenant between contracts may still be
             -- given a code (it just gets the default window). This is the
             -- narrower case where the contract has already run out, where the
             -- cap below would produce an expiry in the past.
             (tenant_access_horizon(id) < bangkok_today()) AS contract_ended
      FROM tenants WHERE id = ${tenantId}::uuid`;
    const tenant = tenants[0];
    if (!tenant) throw notFound('ไม่พบผู้เช่า');
    if (tenant.contract_ended) throw badRequest('สัญญาของผู้เช่ารายนี้สิ้นสุดแล้ว — ต่อสัญญาก่อนออกรหัส');

    const days = await linkCodeWindowDays();
    const code = generateCode();

    // Any code already outstanding is REVOKED, not marked used. Under 010 this
    // set `used_at`, which is the column the เชื่อมแอปแล้ว badge read — so
    // re-issuing to a tenant who had lost their slip made them look linked.
    // Two live codes for one person is still not allowed: the older slip of
    // paper would still work and nobody knows who is holding it.
    const rows = await prisma.$queryRaw<{ code: string; expires_at: Date }[]>`
      WITH revoked AS (
        UPDATE tenant_link_codes SET revoked_at = now()
        WHERE tenant_id = ${tenantId}::uuid AND ${LIVE_CODE}
      )
      INSERT INTO tenant_link_codes (code, tenant_id, issued_by, expires_at)
      SELECT ${code}, ${tenantId}::uuid, ${req.user!.id}::uuid,
             ${CODE_EXPIRY(tenantId, days)}
      RETURNING code, expires_at`;

    await recordAudit(
      'tenant_link_code',
      tenant.id,
      'issued',
      { tenant: tenant.full_name, window_days: days, expires_at: rows[0]?.expires_at },
      req.user!.id,
    );

    res.status(201).json({ link_code: rows[0], tenant: { id: tenant.id, full_name: tenant.full_name } });
  }),
);

/**
 * Extend the live code — the owner asked for "add more expire date to it"
 * rather than forcing a new code on a tenant who is mid-setup.
 *
 * Extends from the code's own expiry, not from now, so extending twice is
 * additive rather than a reset. The contract cap applies here exactly as it
 * does on issue, which is the reason 011 enforces it with a trigger as well:
 * this is the second write path that could push an expiry past the tenancy.
 */
const extendBody = z.object({ days: z.number().int().positive().max(365) });

tenantLinkRoutes.patch(
  '/:id/link-code',
  requireAuth,
  requirePermission('tenancy.manage'),
  asyncHandler(async (req, res) => {
    const tenantId = String(req.params.id);
    const parsed = extendBody.safeParse(req.body);
    if (!parsed.success) throw badRequest('ต้องระบุจำนวนวันที่ต้องการต่ออายุ');

    const rows = await prisma.$queryRaw<{ code: string; expires_at: Date }[]>`
      UPDATE tenant_link_codes
      SET expires_at = LEAST(
            expires_at + (${parsed.data.days}::text || ' days')::interval,
            COALESCE(
              (tenant_access_horizon(tenant_id) + 1)::timestamp AT TIME ZONE 'Asia/Bangkok',
              'infinity'::timestamptz
            )
          )
      WHERE tenant_id = ${tenantId}::uuid AND ${LIVE_CODE}
      RETURNING code, expires_at`;
    if (!rows[0]) throw notFound('ไม่มีรหัสที่ยังใช้งานได้สำหรับผู้เช่ารายนี้');

    await recordAudit(
      'tenant_link_code',
      tenantId,
      'extended',
      { days: parsed.data.days, expires_at: rows[0].expires_at },
      req.user!.id,
    );

    res.json({ link_code: rows[0] });
  }),
);

/**
 * Kill the live code now.
 *
 * `revoked_at`, not a DELETE: the row is how "who issued a code for this
 * tenant, and was it used" stays answerable, and deleting it would take that
 * with it. It works on an already-redeemed code too — that is the point of a
 * window rather than a single use, and the desk needs a way to close it early.
 * Existing sessions are untouched; this stops NEW devices, not old ones.
 */
tenantLinkRoutes.delete(
  '/:id/link-code',
  requireAuth,
  requirePermission('tenancy.manage'),
  asyncHandler(async (req, res) => {
    const tenantId = String(req.params.id);
    const rows = await prisma.$queryRaw<{ code: string; redemptions: number }[]>`
      UPDATE tenant_link_codes SET revoked_at = now()
      WHERE tenant_id = ${tenantId}::uuid AND ${LIVE_CODE}
      RETURNING code, redemptions`;
    if (!rows[0]) throw notFound('ไม่มีรหัสที่ยังใช้งานได้สำหรับผู้เช่ารายนี้');

    await recordAudit(
      'tenant_link_code',
      tenantId,
      'revoked',
      { redemptions: rows[0].redemptions },
      req.user!.id,
    );

    res.json({ revoked: true });
  }),
);

/**
 * What the desk sees. The two badges are read from two columns on `tenants`,
 * which is the whole of migration 011's second half: a redemption is an event
 * and "a device holds a session" is a state, so asking `tenant_link_codes` the
 * second question gave the answer to the first. Under 010 a LINE bind lit
 * เชื่อมแอปแล้ว for a tenant who had never opened the app.
 */
tenantLinkRoutes.get(
  '/:id/link-status',
  requireAuth,
  requirePermission('tenancy.manage'),
  asyncHandler(async (req, res) => {
    const tenantId = String(req.params.id);
    const rows = await prisma.$queryRaw<
      {
        linked: boolean;
        line_linked: boolean;
        last_linked_at: Date | null;
        code_pending: boolean;
        code_expires_at: Date | null;
        code_redemptions: number;
      }[]
    >`
      SELECT
        (t.app_linked_at IS NOT NULL) AS linked,
        (t.line_user_id IS NOT NULL) AS line_linked,
        t.app_linked_at AS last_linked_at,
        (c.code IS NOT NULL) AS code_pending,
        c.expires_at AS code_expires_at,
        COALESCE(c.redemptions, 0)::int AS code_redemptions
      FROM tenants t
      LEFT JOIN LATERAL (
        SELECT code, expires_at, redemptions
        FROM tenant_link_codes
        WHERE tenant_id = t.id AND ${LIVE_CODE}
        ORDER BY expires_at DESC
        LIMIT 1
      ) c ON TRUE
      WHERE t.id = ${tenantId}::uuid`;
    if (!rows[0]) throw notFound('ไม่พบผู้เช่า');
    res.json({ status: rows[0] });
  }),
);

// ------------------------------------------------------------------
// Tenant side
// ------------------------------------------------------------------

const redeemBody = z.object({ code: z.string().trim().toUpperCase().length(CODE_LENGTH) });

/**
 * The only unauthenticated tenant route, and now the only one guessing at.
 *
 * Under 010 a code was single-use and lived 24 hours, which bounded a guessing
 * attack on its own. A seven-day window does not, so the limiter ships with the
 * window rather than after it (ADR-021 D6).
 *
 * Deliberately far more generous than the staff login's five attempts: **the
 * whole building shares one wifi NAT**, so a tight per-IP limit would lock out
 * sixty tenants to stop one attacker. A real tenant redeems once or twice ever.
 * At the default 20 per 15 minutes an attacker gets ~1,900 guesses a day
 * against at most a few dozen live codes out of 32^6 — on the order of 1e-4
 * expected hits per day, and every failure looks identical.
 */
const redeemLimiter = rateLimit({
  windowMs: env.TENANT_REDEEM_RATE_LIMIT_WINDOW_MIN * 60_000,
  limit: env.TENANT_REDEEM_RATE_LIMIT_ATTEMPTS,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'ลองใส่รหัสบ่อยเกินไป กรุณารอสักครู่' },
});

/**
 * Redeem a code for a session.
 *
 * The claim itself is `tenant/link-codes.ts`, shared with the LINE webhook: the
 * same six characters bind an account when sent in the chat, and the window is
 * a property of one UPDATE rather than of two copies of one. Redeeming here
 * also stamps `tenants.app_linked_at`, which is what the desk's เชื่อมแอปแล้ว
 * badge reads — a LINE bind does not set it, and that separation is the point.
 */
tenantAppRoutes.post(
  '/auth/redeem',
  redeemLimiter,
  asyncHandler(async (req, res) => {
    const parsed = redeemBody.safeParse(req.body);
    if (!parsed.success) throw badRequest('รหัสเชื่อมบัญชีต้องมี 6 หลัก');

    // The browser never binds a LINE account, so `TenantAlreadyBoundError`
    // cannot arise here — it is a webhook-only outcome (D5).
    const row = await claimLinkCode(parsed.data.code);
    // One message for expired, used and never-existed alike: distinguishing
    // them tells someone guessing codes which guesses were real.
    if (!row) throw badRequest('รหัสไม่ถูกต้องหรือหมดอายุแล้ว — ขอรหัสใหม่จากสำนักงาน');

    res.json({
      token: signTenantToken({ id: row.tenant_id, name: row.full_name }),
      tenant: { id: row.tenant_id, full_name: row.full_name },
    });
  }),
);

/**
 * S33 — who the tenant is, where they live, and what they owe.
 *
 * The tenancy is the active one; a tenant between contracts sees their name and
 * an empty room panel rather than a 404, because the notification list below is
 * still theirs to read.
 */
tenantAppRoutes.get(
  '/me',
  requireTenant,
  asyncHandler(async (req, res) => {
    const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT t.id, t.full_name, t.phone, (t.line_user_id IS NOT NULL) AS line_linked,
             tn.id AS tenancy_id, tn.start_date, tn.end_date, tn.agreed_months,
             tn.monthly_rent::float8 AS monthly_rent,
             tn.deposit_amount::float8 AS deposit_amount,
             r.room_number, rt.name_th AS room_type_name
      FROM tenants t
      LEFT JOIN tenancies tn ON tn.tenant_id = t.id AND tn.status = 'active'
      LEFT JOIN rooms r ON r.id = tn.room_id
      LEFT JOIN room_types rt ON rt.id = r.room_type_id
      WHERE t.id = ${req.tenant!.id}::uuid`;
    if (!rows[0]) throw notFound('ไม่พบผู้เช่า');

    const unread = await prisma.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count FROM notifications
      WHERE tenant_id = ${req.tenant!.id}::uuid AND read_at IS NULL`;

    res.json({ me: rows[0], unread_count: unread[0]?.count ?? 0 });
  }),
);

/**
 * S34 — the tenant's own bills.
 *
 * Reuses the staff query's own column list, including the late fee. That reuse
 * is the point: never-violate rule 3 says the fee is live while unpaid and
 * frozen once verified, and a tenant reading a different number from the office
 * would be the same bug as computing it twice.
 */
tenantAppRoutes.get(
  '/invoices',
  requireTenant,
  asyncHandler(async (req, res) => {
    const invoices = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT ${INVOICE_COLUMNS} ${INVOICE_FROM}
       WHERE tn.tenant_id = $1::uuid AND i.status <> 'deleted'
       ORDER BY i.billing_period DESC`,
      req.tenant!.id,
    );
    res.json({ invoices });
  }),
);

/** One bill, with the meter readings behind its utility charge. Scoped by tenant. */
tenantAppRoutes.get(
  '/invoices/:id',
  requireTenant,
  asyncHandler(async (req, res) => {
    // The tenant_id predicate is what makes the id in the URL harmless: a bill
    // belonging to someone else is not "forbidden", it simply is not found.
    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT ${INVOICE_COLUMNS} ${INVOICE_FROM}
       WHERE i.id = $1::uuid AND tn.tenant_id = $2::uuid AND i.status <> 'deleted'`,
      req.params.id,
      req.tenant!.id,
    );
    const invoice = rows[0];
    if (!invoice) throw notFound('ไม่พบบิล');

    // The meter numbers behind utility_charge — the same query the staff bill
    // screen runs. Rule 7 makes this tenant-visible by design: a lump sum the
    // tenant cannot check is what the meter chain exists to prevent.
    const utility_lines = await prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT mr.meter_type, mr.old_reading::float8 AS old_reading, mr.new_reading::float8 AS new_reading,
             mr.rate::float8 AS rate, mr.computed_cost::float8 AS computed_cost, mr.is_estimated,
             -- Which room this line is FOR. In an ordinary month it is the one
             -- room and adds nothing; in a transfer month there are two of
             -- every meter (rule 13, Rule 10.3) and without the room number the
             -- bill shows two electric lines and no way to tell them apart.
             rm.room_number
      FROM meter_readings mr
      JOIN rooms rm ON rm.id = mr.room_id
      JOIN invoices i ON i.tenancy_id = mr.tenancy_id AND i.billing_period = mr.reading_period
      WHERE i.id = ${req.params.id}::uuid
      ORDER BY rm.room_number, mr.meter_type`;

    // Rule 7: the tenant can see that a bill was edited, and why.
    const status_history = await prisma.$queryRaw<Record<string, unknown>[]>`
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

    res.json({ invoice, utility_lines, status_history, transfers });
  }),
);

/** S38 — the notification list. This is Rule 6.13's proof, read by the person it names. */
tenantAppRoutes.get(
  '/notifications',
  requireTenant,
  asyncHandler(async (req, res) => {
    const notifications = await prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT id, event, ref_id, title, body, amount::float8 AS amount, due_date,
             created_at, read_at, line_status
      FROM notifications
      WHERE tenant_id = ${req.tenant!.id}::uuid
      ORDER BY created_at DESC
      LIMIT 100`;
    res.json({ notifications });
  }),
);

/**
 * Marking one read. The only column a tenant may write on a notification —
 * `trg_block_notification_edit` (009) rejects anything else at the database,
 * so this is one of two independent answers, not the only one.
 */
tenantAppRoutes.post(
  '/notifications/:id/read',
  requireTenant,
  asyncHandler(async (req, res) => {
    const rows = await prisma.$queryRaw<{ id: string; read_at: Date | null }[]>`
      UPDATE notifications SET read_at = COALESCE(read_at, now())
      WHERE id = ${req.params.id}::uuid AND tenant_id = ${req.tenant!.id}::uuid
      RETURNING id, read_at`;
    if (!rows[0]) throw notFound('ไม่พบการแจ้งเตือน');
    res.json({ notification: rows[0] });
  }),
);

/**
 * S38's toggles. LINE only — rule 15 and migration 009's
 * `CHECK (channel = 'line')` mean there is no in-app row to write, so the
 * screen renders that toggle checked and disabled and this endpoint has no
 * value it could store for it.
 */
const LINE_TOGGLEABLE = [
  'bill_issued',
  'payment_verified',
  'announcement',
  'due_reminder',
  'overdue',
] as const;

tenantAppRoutes.get(
  '/notification-prefs',
  requireTenant,
  asyncHandler(async (req, res) => {
    const rows = await prisma.$queryRaw<{ event: string; enabled: boolean }[]>`
      SELECT event, enabled FROM notification_prefs
      WHERE tenant_id = ${req.tenant!.id}::uuid AND channel = 'line'`;
    const stored = new Map(rows.map((r) => [r.event, r.enabled]));

    // Absence means "not chosen yet". The default lives with the Phase 3
    // sender, and is repeated here so the screen shows the same thing the
    // sender will do: bills and payments on, announcements off until asked for.
    res.json({
      prefs: LINE_TOGGLEABLE.map((event) => ({
        event,
        enabled: stored.get(event) ?? event !== 'announcement',
        chosen: stored.has(event),
      })),
    });
  }),
);

const prefBody = z.object({
  event: z.enum(LINE_TOGGLEABLE),
  enabled: z.boolean(),
});

tenantAppRoutes.put(
  '/notification-prefs',
  requireTenant,
  asyncHandler(async (req, res) => {
    const parsed = prefBody.safeParse(req.body);
    if (!parsed.success) throw badRequest('เลือกประเภทการแจ้งเตือนไม่ถูกต้อง');

    const rows = await prisma.$queryRaw<{ event: string; enabled: boolean }[]>`
      INSERT INTO notification_prefs (tenant_id, channel, event, enabled)
      VALUES (${req.tenant!.id}::uuid, 'line', ${parsed.data.event}, ${parsed.data.enabled})
      ON CONFLICT (tenant_id, channel, event) DO UPDATE SET enabled = EXCLUDED.enabled
      RETURNING event, enabled`;
    res.json({ pref: rows[0] });
  }),
);
