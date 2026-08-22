import { Prisma } from '@prisma/client';

/**
 * The in-app notification record — Business Rule 6.13's proof a tenant was told.
 *
 * Phase 1 of docs/LINE_INTEGRATION_PLAN.md. Two things shape everything here:
 *
 * 1. **The proof cannot be missing while the event exists.** So nothing in this
 *    file issues its own query. Every builder returns a CTE that the caller
 *    splices into the statement that already writes the event, which makes the
 *    notification and the invoice (or the verification, or the announcement)
 *    one atomic write. A notification inserted afterwards is a notification
 *    that a crash, a rollback or a 409 can lose.
 * 2. **Never-violate rule 15.** In-app is the record and LINE is a copy, so the
 *    LINE copy's state is columns on this row and the wording of every message
 *    lives in this one file. `amount` and `due_date` are stored structured so
 *    that the Phase 3 renderer (`line/messages.ts`) never reads `body`.
 *
 * The LINE push itself is never in the request path — a LINE outage must not
 * roll back an invoice. These rows are a queue; Phase 3 drains it.
 */

export const NOTIFICATION_EVENTS = [
  'bill_issued',
  'payment_verified',
  'payment_rejected',
  'announcement',
  'due_reminder',
  'overdue',
  'contract_expiring',
] as const;

export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

/**
 * Rule 15's actual list: "LINE carries amount and due date only" — for these
 * events and no others (owner, 2026-08-17: bill issued, payment confirmed,
 * due/overdue reminder, announcements).
 *
 * An event outside this set is born `skipped`, not `pending`: the sender is not
 * allowed to invent a message for it, so leaving it queued would only mean a
 * row the sender must look at forever. Phase 3's `messages.ts` has a template
 * per member of this set and imports the set from here, so adding an event
 * without deciding whether LINE carries it is a compile error rather than a
 * silent send.
 */
export const LINE_CARRIES: ReadonlySet<NotificationEvent> = new Set<NotificationEvent>([
  'bill_issued',
  'payment_verified',
  'announcement',
  'due_reminder',
  'overdue',
]);

/**
 * Wrap a SELECT into the notifications INSERT, as a CTE named `notice`.
 *
 * `source` must yield exactly: tenant_id, ref_id, title, body, amount, due_date
 * — and it must be joined to the CTE that writes the event, so that zero rows
 * of event produce zero notifications.
 *
 * ON CONFLICT DO NOTHING leans on 009's UNIQUE (tenant_id, event, ref_id): a
 * retried batch, a double-clicked button or a reminder tick that runs twice in
 * a day writes one row, so no emit point has to check whether it already told
 * somebody. Postgres runs a data-modifying CTE even when the outer SELECT does
 * not reference it, which is why `notice` never appears in the final SELECT.
 */
function notice(event: NotificationEvent, source: Prisma.Sql): Prisma.Sql {
  // The standing rule for the event. `source` may narrow it — never widen it —
  // by yielding its own `line_status`: S41's "ส่ง LINE ด้วย" tick is the office
  // choosing not to send a copy of a message LINE is otherwise allowed to
  // carry. Every builder below yields the column, NULL meaning "no opinion",
  // because a missing column here is a SQL error at run time, not a type error.
  const lineStatus = LINE_CARRIES.has(event) ? 'pending' : 'skipped';
  return Prisma.sql`notice AS (
    INSERT INTO notifications (tenant_id, event, ref_id, title, body, amount, due_date, line_status)
    SELECT s.tenant_id, ${event}, s.ref_id, s.title, s.body, s.amount, s.due_date,
           COALESCE(s.line_status, ${lineStatus})
    FROM (${source}) s
    ON CONFLICT (tenant_id, event, ref_id) DO NOTHING
    RETURNING id
  )`;
}

/** "no opinion — use the event's standing rule". Spelled once, used by three builders. */
const NO_LINE_OPINION = Prisma.sql`NULL::text AS line_status`;

/**
 * Where the row values come from. Every field is a SQL expression evaluated
 * against `from`, not a JavaScript value: the invoice number, the amount and
 * the due date only exist inside the statement being written.
 */
type Source = {
  /** The tenant being told. */
  tenant: Prisma.Sql;
  /** The invoice / payment / announcement / tenancy this is about. */
  ref: Prisma.Sql;
  /** FROM … JOIN …, referencing the caller's own CTE. */
  from: Prisma.Sql;
};

/** ฿ and the Buddhist year are formatted by 009's thai_baht/thai_date/thai_month. */

export function billIssuedNotice(
  src: Source & { room: Prisma.Sql; period: Prisma.Sql; amount: Prisma.Sql; due: Prisma.Sql },
): Prisma.Sql {
  return notice(
    'bill_issued',
    Prisma.sql`
      SELECT ${src.tenant} AS tenant_id, ${src.ref} AS ref_id,
             'บิลค่าเช่าใหม่' AS title,
             format('ห้อง %s · งวด %s · ยอดชำระ %s · กำหนดชำระ %s',
                    ${src.room}, thai_month(${src.period}),
                    thai_baht(${src.amount}), thai_date(${src.due})) AS body,
             ${src.amount} AS amount, ${src.due} AS due_date, ${NO_LINE_OPINION}
      ${src.from}`,
  );
}

/**
 * The receipt side of ADR-009: `amount` is what was actually settled, frozen
 * late fee included, because that is the figure on the receipt.
 */
export function paymentVerifiedNotice(
  src: Source & { room: Prisma.Sql; period: Prisma.Sql; amount: Prisma.Sql },
): Prisma.Sql {
  return notice(
    'payment_verified',
    Prisma.sql`
      SELECT ${src.tenant} AS tenant_id, ${src.ref} AS ref_id,
             'ยืนยันการชำระเงินแล้ว' AS title,
             format('ห้อง %s · งวด %s · รับชำระ %s เรียบร้อยแล้ว ขอบคุณค่ะ',
                    ${src.room}, thai_month(${src.period}), thai_baht(${src.amount})) AS body,
             ${src.amount} AS amount, NULL::date AS due_date, ${NO_LINE_OPINION}
      ${src.from}`,
  );
}

/**
 * Carries no amount and no due date, and LINE does not carry it at all
 * (LINE_CARRIES) — a rejection needs the reason to mean anything, and rule 15
 * keeps free text off LINE. The tenant reads it in the app, which is the record.
 */
export function paymentRejectedNotice(
  src: Source & { room: Prisma.Sql; period: Prisma.Sql; reason: Prisma.Sql },
): Prisma.Sql {
  return notice(
    'payment_rejected',
    Prisma.sql`
      SELECT ${src.tenant} AS tenant_id, ${src.ref} AS ref_id,
             'สลิปไม่ผ่านการตรวจสอบ' AS title,
             format('ห้อง %s · งวด %s · เหตุผล: %s · กรุณาส่งสลิปใหม่อีกครั้ง',
                    ${src.room}, thai_month(${src.period}), ${src.reason}) AS body,
             NULL::numeric AS amount, NULL::date AS due_date, ${NO_LINE_OPINION}
      ${src.from}`,
  );
}

/**
 * Phase 4's tick, a few days before the due date.
 *
 * `amount` is the invoice total and nothing else. The late fee is live until it
 * freezes onto the invoice at submission (ADR-009), so a figure stored here
 * would be a number that stops being true the next morning — `line/messages.ts`
 * makes the same choice for the same reason, and the app shows the live total.
 */
export function dueReminderNotice(
  src: Source & { room: Prisma.Sql; period: Prisma.Sql; amount: Prisma.Sql; due: Prisma.Sql },
): Prisma.Sql {
  return notice(
    'due_reminder',
    Prisma.sql`
      SELECT ${src.tenant} AS tenant_id, ${src.ref} AS ref_id,
             'ใกล้ถึงกำหนดชำระ' AS title,
             format('ห้อง %s · งวด %s · ยอดชำระ %s · กำหนดชำระ %s · ชำระภายในกำหนดเพื่อไม่ให้มีค่าปรับ',
                    ${src.room}, thai_month(${src.period}),
                    thai_baht(${src.amount}), thai_date(${src.due})) AS body,
             ${src.amount} AS amount, ${src.due} AS due_date, ${NO_LINE_OPINION}
      ${src.from}`,
  );
}

/**
 * The day the ฿50/day starts (Rule 3), told once.
 *
 * Once, not daily: 009's UNIQUE (tenant_id, event, ref_id) means a tenant is
 * told their bill is late one time per bill, however often the tick runs. A
 * notice per day of lateness would be the same fact repeated at a tenant who
 * already knows, and it would spend the 300-push tier saying it.
 *
 * The body states the rule and never a running total, for the reason above.
 */
export function overdueNotice(
  src: Source & { room: Prisma.Sql; period: Prisma.Sql; amount: Prisma.Sql; due: Prisma.Sql },
): Prisma.Sql {
  return notice(
    'overdue',
    Prisma.sql`
      SELECT ${src.tenant} AS tenant_id, ${src.ref} AS ref_id,
             'เกินกำหนดชำระแล้ว' AS title,
             format('ห้อง %s · งวด %s · ยอดชำระ %s · ครบกำหนดเมื่อ %s · มีค่าปรับวันละ ฿50 นับจากวันถัดไป',
                    ${src.room}, thai_month(${src.period}),
                    thai_baht(${src.amount}), thai_date(${src.due})) AS body,
             ${src.amount} AS amount, ${src.due} AS due_date, ${NO_LINE_OPINION}
      ${src.from}`,
  );
}

/**
 * S41. The title and body are the announcement's own words, not a template —
 * this is the one event whose text a person typed.
 */
export function announcementNotice(
  src: Source & { title: Prisma.Sql; body: Prisma.Sql; sendLine: Prisma.Sql },
): Prisma.Sql {
  return notice(
    'announcement',
    Prisma.sql`
      SELECT DISTINCT ${src.tenant} AS tenant_id, ${src.ref} AS ref_id,
             ${src.title} AS title, ${src.body} AS body,
             NULL::numeric AS amount, NULL::date AS due_date,
             -- 007's send_line finally does something. Until Phase 5 the flag
             -- was stored and ignored: every announcement was queued for LINE
             -- whatever the office ticked, and only the tenant's own preference
             -- could stop it. Decided here, inside the caller's own statement,
             -- because the announcement CTE is only in scope here.
             CASE WHEN ${src.sendLine} THEN 'pending' ELSE 'skipped' END AS line_status
      ${src.from}`,
  );
}
