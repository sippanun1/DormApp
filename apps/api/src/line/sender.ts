import { prisma } from '../db/prisma.js';
import { env } from '../env.js';
import { LineError, pushMessage } from './client.js';
import { buildLineMessage } from './messages.js';

/**
 * Drains the LINE queue — the `pending` rows of `notifications`.
 *
 * The queue is the record: `notify/emit.ts` writes the in-app notification in
 * the same statement as the invoice it is about, and this file delivers the
 * copy afterwards. Nothing here is ever in a request path — a LINE outage must
 * not roll back an invoice, and a slow push must not hold a tenant's screen.
 *
 * Rule 15 in three places: what may be said is `messages.ts`, which events may
 * be said at all is `LINE_CARRIES` in `emit.ts`, and whether this tenant wants
 * them is `notification_prefs`. This file decides none of those — it only
 * decides whether a row is deliverable now.
 */

/** Rows per tick. Small: two instances both draining is normal, and 300/month is the cap. */
const BATCH = 20;

/**
 * A row claimed by this instance but never resolved — the process died between
 * the claim and the outcome.
 *
 * Marked `failed`, not requeued. Requeueing would re-push a message that may
 * already have arrived, spending a second slot of 300 to tell a tenant the same
 * thing twice; and the in-app notification, which is the actual proof under
 * Rule 6.13, is untouched either way. LINE is the copy — losing a copy is the
 * cheaper error.
 */
const STUCK_AFTER_MINUTES = 10;

interface ClaimedRow {
  id: string;
  event: string;
  amount: string | number | null;
  due_date: Date | null;
  line_user_id: string | null;
  pref_enabled: boolean | null;
}

async function markSent(id: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE notifications SET line_status = 'sent', line_sent_at = now(), line_error = NULL
    WHERE id = ${id}::uuid`;
}

async function markSkipped(id: string, reason: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE notifications SET line_status = 'skipped', line_error = ${reason}
    WHERE id = ${id}::uuid`;
}

async function markFailed(id: string, reason: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE notifications SET line_status = 'failed', line_error = ${reason.slice(0, 500)}
    WHERE id = ${id}::uuid`;
}

/** Pushes already sent this Bangkok month. The free tier's 300 is a calendar-month cap. */
export async function monthlyPushCount(): Promise<number> {
  const rows = await prisma.$queryRaw<{ used: number }[]>`
    SELECT count(*)::int AS used FROM notifications
    WHERE line_status = 'sent'
      AND (line_sent_at AT TIME ZONE 'Asia/Bangkok')::date >= date_trunc('month', bangkok_today())::date`;
  return rows[0]?.used ?? 0;
}

/**
 * One pass. Returns what happened, for the smoke suite and the log.
 *
 * Never throws: a sender that can throw is a sender that stops draining the
 * queue the first time LINE has a bad minute.
 */
export async function sendPendingLineMessages(): Promise<{
  sent: number;
  skipped: number;
  failed: number;
}> {
  const result = { sent: 0, skipped: 0, failed: 0 };
  if (!env.lineConfigured) return result;

  try {
    // A claim this instance abandoned. Resolved before claiming more, so a
    // crashed batch cannot sit in 'sending' forever and hide in the queue.
    await prisma.$executeRaw`
      UPDATE notifications
      SET line_status = 'failed',
          line_error = 'the sender stopped before this row was resolved; the in-app notice stands'
      WHERE line_status = 'sending'
        AND created_at < now() - ${`${STUCK_AFTER_MINUTES} minutes`}::interval`;

    /*
     * Claim, so two Railway instances cannot both push one row. FOR UPDATE SKIP
     * LOCKED inside the CTE means the loser of a race takes different rows
     * rather than waiting for them, and the UPDATE makes the claim visible to
     * the next tick as `sending` rather than `pending`.
     */
    const claimed = await prisma.$queryRaw<ClaimedRow[]>`
      WITH due AS (
        SELECT id FROM notifications
        WHERE line_status = 'pending'
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT ${BATCH}
      )
      UPDATE notifications n
      SET line_status = 'sending'
      FROM due d, tenants t
      WHERE n.id = d.id AND t.id = n.tenant_id
      RETURNING n.id, n.event, n.amount, n.due_date, t.line_user_id,
                (SELECT p.enabled FROM notification_prefs p
                  WHERE p.tenant_id = n.tenant_id AND p.channel = 'line' AND p.event = n.event)
                AS pref_enabled`;

    if (claimed.length === 0) return result;

    let used = await monthlyPushCount();

    for (const row of claimed) {
      // No LINE account: skipped, recorded, and the in-app record still stands
      // — exactly what the announcements screen already promises staff.
      if (!row.line_user_id) {
        await markSkipped(row.id, 'ผู้เช่ายังไม่ได้เชื่อมบัญชี LINE');
        result.skipped += 1;
        continue;
      }

      // Absence means "not chosen yet". The default is repeated in
      // tenant.routes.ts so S38 shows what this will actually do: bills and
      // payments on, announcements off unless the tenant asked for them.
      const enabled = row.pref_enabled ?? row.event !== 'announcement';
      if (!enabled) {
        await markSkipped(row.id, 'ผู้เช่าปิดการแจ้งเตือน LINE ของเหตุการณ์นี้');
        result.skipped += 1;
        continue;
      }

      const text = buildLineMessage({
        event: row.event as never,
        amount: row.amount === null ? null : Number(row.amount),
        dueDate: row.due_date,
      });
      // No template means LINE may not carry this event at all. Such rows are
      // born 'skipped' in emit.ts; one arriving here means LINE_CARRIES and
      // messages.ts have drifted apart, so say so rather than dropping it.
      if (!text) {
        await markSkipped(row.id, 'LINE ไม่รองรับการแจ้งเตือนประเภทนี้');
        result.skipped += 1;
        continue;
      }

      // The free tier. Over the cap is not an error to retry — it is skipped,
      // recorded, and readable on the reports screen (Phase 5).
      if (used >= env.LINE_MONTHLY_PUSH_CAP) {
        await markSkipped(row.id, `เกินโควตา LINE ${env.LINE_MONTHLY_PUSH_CAP} ข้อความ/เดือน`);
        result.skipped += 1;
        continue;
      }

      try {
        await pushMessage(row.line_user_id, text);
        await markSent(row.id);
        used += 1;
        result.sent += 1;
      } catch (err) {
        // Terminal, deliberately: retrying on a tick would re-push a message
        // that may have arrived, and burn quota doing it. A failure is visible
        // in `line_error`; the in-app notice was never at risk.
        await markFailed(row.id, err instanceof LineError ? err.message : String(err));
        result.failed += 1;
      }
    }
  } catch (err) {
    // The queue is drained again on the next tick; a bad minute is not an outage.
    console.error('[line:sender]', err);
  }

  return result;
}

/**
 * The tick. Started from index.ts only when LINE is configured, so a machine
 * with no credentials runs no timer and logs nothing.
 *
 * `unref()` so the interval never holds the process open — a deploy that is
 * shutting down should not wait for a notification timer.
 */
export function startLineSender(): NodeJS.Timeout {
  const everyMs = env.LINE_SEND_INTERVAL_SEC * 1000;
  console.log(
    `[line:sender] draining every ${env.LINE_SEND_INTERVAL_SEC}s` +
      `${env.lineDryRun ? ' (DRY RUN — nothing leaves this process)' : ''}`,
  );
  const timer = setInterval(() => {
    void sendPendingLineMessages();
  }, everyMs);
  timer.unref();
  return timer;
}
