import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { env } from '../env.js';
import { dueReminderNotice, overdueNotice } from './emit.js';

/**
 * Phase 4 of docs/LINE_INTEGRATION_PLAN.md — the due and overdue reminders.
 *
 * This **reads** invoices and computes no money. CLAUDE.md's "no cron for
 * money" stays literally true: the late fee is still derived on read by
 * `LIVE_LATE_FEE` and still freezes onto the invoice only when a payment is
 * submitted (ADR-009). Nothing here writes to `invoices` at all.
 *
 * Idempotence is 009's `UNIQUE (tenant_id, event, ref_id)`, not a "last run"
 * timestamp: a tenant is told once per bill however often the tick runs, so the
 * tick needs no memory, survives a restart mid-pass, and two Railway instances
 * ticking at once cannot double-notify. That is also why the windows below are
 * ranges rather than "is today exactly the reminder day" — a service that was
 * down on the one qualifying day would otherwise skip that bill for ever.
 *
 * The in-app row is the point (Rule 6.13); LINE is a copy, so this runs whether
 * or not LINE is configured. `line_status` starts `pending` for both events —
 * they are in `LINE_CARRIES` — and the Phase 3 sender decides the rest.
 */

/**
 * Bills that are actually owed.
 *
 * `pending_verification` is excluded: the tenant has sent a slip and is waiting
 * on the office, and telling them they are late is the office's own delay
 * landing on them. `rejected` is included — the slip was refused, so the bill
 * is owed again, which is exactly the state that needs saying.
 */
const OWED = Prisma.sql`i.status IN ('unpaid', 'rejected')`;

/** The columns both notices read, from the caller's CTE. */
const FROM_DUE = {
  tenant: Prisma.sql`d.tenant_id`,
  ref: Prisma.sql`d.invoice_id`,
  room: Prisma.sql`d.room_number`,
  period: Prisma.sql`d.billing_period`,
  amount: Prisma.sql`d.total_amount`,
  due: Prisma.sql`d.due_date`,
  from: Prisma.sql`FROM due d`,
};

/** bangkok_today(), never CURRENT_DATE — the pooler is UTC for seven hours a day. */
const candidates = (window: Prisma.Sql): Prisma.Sql => Prisma.sql`
  due AS (
    SELECT tn.tenant_id, i.id AS invoice_id, r.room_number,
           i.billing_period, i.total_amount, i.due_date
    FROM invoices i
    JOIN tenancies tn ON tn.id = i.tenancy_id
    JOIN rooms r ON r.id = tn.room_id
    WHERE ${OWED} AND ${window}
  )`;

async function emit(window: Prisma.Sql, build: (src: typeof FROM_DUE) => Prisma.Sql): Promise<number> {
  const rows = await prisma.$queryRaw<{ n: number }[]>`
    WITH ${candidates(window)}, ${build(FROM_DUE)}
    SELECT count(*)::int AS n FROM notice`;
  return rows[0]?.n ?? 0;
}

export interface ReminderTickResult {
  due_reminder: number;
  overdue: number;
}

export async function runReminderTick(): Promise<ReminderTickResult> {
  // From `due_reminder_days` before the due date up to the due date itself.
  // The owner's policy (S43) decides the lead time; `due_day` is not read here
  // because the invoice carries its own `due_date` — a bill keeps the due date
  // it was issued with, even if the policy moves afterwards.
  const due_reminder = await emit(
    Prisma.sql`bangkok_today() >= i.due_date
                 - ((SELECT value::int FROM system_settings WHERE key = 'due_reminder_days')
                    || ' days')::interval
               AND bangkok_today() <= i.due_date`,
    dueReminderNotice,
  );

  // The day the ฿50/day starts. Deliberately `> due_date` and not a
  // `grace_days` reading: this must agree with `LIVE_LATE_FEE`
  // (invoices.routes.ts), which charges from the day after the due date. A
  // reminder that says "you are late" on a day the system charges nothing —
  // or stays silent on a day it charges ฿50 — would be worse than no reminder.
  const overdue = await emit(Prisma.sql`bangkok_today() > i.due_date`, overdueNotice);

  return { due_reminder, overdue };
}

/**
 * The tick. Started unconditionally, unlike the LINE sender: the in-app notice
 * is the record Rule 6.13 requires, and a building with no LINE credentials
 * still owes its tenants that.
 *
 * Hourly by default rather than daily. These are date-based, so the hour does
 * not matter — but a daily timer restarted by every deploy could drift past the
 * one moment it was meant to fire, and hourly makes "the service was down" cost
 * an hour instead of a day. Running it more often is free: `ON CONFLICT DO
 * NOTHING` means every pass after the first inserts nothing.
 *
 * No immediate run at startup, so the smoke suite can raise the interval and
 * drive the tick explicitly instead of racing a timer.
 */
export function startReminderTick(): NodeJS.Timeout {
  console.log(`[notify:reminders] ticking every ${env.REMINDER_TICK_SEC}s`);
  const timer = setInterval(() => {
    void runReminderTick().catch((err) => console.error('[notify:reminders]', err));
  }, env.REMINDER_TICK_SEC * 1000);
  // Never hold the process open — a deploy shutting down should not wait.
  timer.unref();
  return timer;
}
