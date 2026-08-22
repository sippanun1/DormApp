import { config } from 'dotenv';
import { resolve } from 'node:path';
import { z } from 'zod';

// One .env at the repo root — both services read the same file (apps/api/src → repo root).
config({ path: resolve(process.cwd(), '../../.env') });

const schema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required (Supabase pooled connection, port 6543)'),
  DIRECT_URL: z.string().min(1, 'DIRECT_URL is required (Supabase direct connection, port 5432)'),

  SUPABASE_URL: z.string().url(),
  // Supabase renamed these in 2025 (publishable/secret); the old anon/service_role
  // names still exist on older projects, so accept either and normalise below.
  SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SECRET_KEY: z.string().optional(),
  SUPABASE_SERVICE_KEY: z.string().optional(),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 chars — openssl rand -base64 48'),
  JWT_EXPIRES_IN: z.string().default('10h'),
  // A tenant cannot re-authenticate on their own — the only way to get another
  // session is a new code from the office — so a staff-length expiry would lock
  // them out of their own bills overnight. Read-mostly session (Phase 2).
  TENANT_JWT_EXPIRES_IN: z.string().default('30d'),
  LOGIN_RATE_LIMIT_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_RATE_LIMIT_WINDOW_MIN: z.coerce.number().int().positive().default(15),
  // Redeeming a link code (ADR-021 D6). Much looser than the staff login above,
  // and not by oversight: the whole building shares one wifi NAT, so a tight
  // per-IP limit locks out sixty tenants to stop one attacker. A tenant redeems
  // once or twice ever; this still leaves guessing hopeless against 32^6.
  TENANT_REDEEM_RATE_LIMIT_ATTEMPTS: z.coerce.number().int().positive().default(20),
  TENANT_REDEEM_RATE_LIMIT_WINDOW_MIN: z.coerce.number().int().positive().default(15),

  // Phase 3 of docs/LINE_INTEGRATION_PLAN.md. Optional: the API must start and
  // serve every other route on a machine with no LINE credentials at all — the
  // sender no-ops and the webhook returns 503 rather than the process refusing
  // to boot. ONE Messaging API channel, and no LIFF id or login channel id:
  // LINE carries notifications and is never how a tenant signs in (correction
  // 2026-08-21).
  LINE_CHANNEL_SECRET: z.string().optional(),
  LINE_CHANNEL_ACCESS_TOKEN: z.string().optional(),
  // The free tier. A push beyond it is not an error to retry — it is `skipped`,
  // recorded, and the in-app record still stands.
  LINE_MONTHLY_PUSH_CAP: z.coerce.number().int().nonnegative().default(300),
  // Anything that is not production defaults to dry-run: a smoke run must never
  // put a real message on a real tenant's phone.
  // Left `undefined` when unset rather than coerced to false: "not chosen" and
  // "chosen off" are different, and only the first may fall back to NODE_ENV.
  LINE_DRY_RUN: z
    .enum(['0', '1'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === '1')),
  // How often the queue is drained. Notifications are not urgent to the second
  // and every tick is a database round trip on both instances.
  LINE_SEND_INTERVAL_SEC: z.coerce.number().int().positive().default(60),
  // Phase 4's due/overdue tick. Hourly, not daily: the reminders are date-based
  // so the hour is irrelevant, but a daily timer restarted by every deploy can
  // drift past the moment it was meant to fire. Re-running costs nothing —
  // 009's unique key means every pass after the first inserts no rows.
  REMINDER_TICK_SEC: z.coerce.number().int().positive().default(3600),

  UPLOAD_MAX_SIZE: z.coerce.number().int().positive().default(5_242_880),
  SLIP_BUCKET: z.string().default('slips'),

  // Not cosmetic: ADR-009 freezes the late fee into the invoice, so a service
  // running UTC bills ฿50 up to seven hours early and the error is permanent.
  TZ: z.literal('Asia/Bangkok', {
    errorMap: () => ({ message: 'TZ must be Asia/Bangkok (Master Document §18.2 / ADR-009)' }),
  }),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
  console.error(`Invalid environment:\n${lines.join('\n')}\n\nCopy .env.example to .env and fill it in.`);
  process.exit(1);
}

const raw = parsed.data;

const supabaseSecretKey = raw.SUPABASE_SECRET_KEY || raw.SUPABASE_SERVICE_KEY;
const supabasePublicKey = raw.SUPABASE_PUBLISHABLE_KEY || raw.SUPABASE_ANON_KEY;

if (!supabaseSecretKey) {
  console.error(
    'Missing Supabase secret key. Set SUPABASE_SECRET_KEY (sb_secret_…) — or the legacy SUPABASE_SERVICE_KEY — from Project Settings → API Keys.',
  );
  process.exit(1);
}

/**
 * Dry run unless production explicitly opts in. `LINE_DRY_RUN` unset in
 * development means "on": the failure mode of getting this backwards is a real
 * message to a real tenant from a test run, which cannot be taken back.
 */
const lineDryRun = raw.LINE_DRY_RUN ?? raw.NODE_ENV !== 'production';

export const env = {
  ...raw,
  lineDryRun,
  /** Both halves or neither — a secret with no token can verify a webhook it cannot answer. */
  lineConfigured: Boolean(raw.LINE_CHANNEL_SECRET && raw.LINE_CHANNEL_ACCESS_TOKEN),
  /** Server-side only. Never expose this to the browser. */
  supabaseSecretKey,
  supabasePublicKey,
};
