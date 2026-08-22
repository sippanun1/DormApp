import { LINE_CARRIES, type NotificationEvent } from '../notify/emit.js';

/**
 * The ONLY place a LINE message body is constructed (CLAUDE.md rule 15).
 *
 * Rule 15 says LINE carries amount and due date only — never slips, never
 * personal data — and the way that is enforced here is the input type. There is
 * no free-text parameter and no URL parameter, so there is no argument through
 * which a slip path, an ID number or a rejection reason could be passed. A call
 * site that wanted to say more would have to change this file, which is a
 * different kind of act from writing a message.
 *
 * Two deliberate narrowings of the Phase 3 sketch in the plan document:
 *
 *   * **No room number.** The sketch's input type had one. Rule 15's wording is
 *     "amount and due date only", and a room number is the one piece of a
 *     tenant's address that a stranger reading a lock-screen preview could use.
 *     The tenant knows which room is theirs; the app has the rest.
 *   * **No deep link.** A URL carrying a token would make the message itself a
 *     credential, and a message forwarded in a family chat would hand over a
 *     tenant's bills. The bare domain is safe but adds nothing the pinned rich
 *     menu does not already give.
 *
 * Everything the tenant cannot see here is one tap away in the app, which is
 * the record (Rule 6.13). LINE is the copy.
 */

/** Structured, from the notification row's own typed columns — never from `body`. */
export interface LineMessageInput {
  event: NotificationEvent;
  /** `notifications.amount`, already NUMERIC. Null for events that carry no figure. */
  amount: number | null;
  /** `notifications.due_date`. Null for events that carry no date. */
  dueDate: Date | null;
}

/** ฿4,150 — CLAUDE.md's money convention, matching the database's `thai_baht`. */
function baht(amount: number): string {
  const whole = Number.isInteger(amount) ? amount : Number(amount.toFixed(2));
  return `฿${whole.toLocaleString('en-US', {
    minimumFractionDigits: Number.isInteger(whole) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

const THAI_MONTHS = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

/**
 * "17 ก.ค. 69" — the Buddhist year, as every screen shows it.
 *
 * Read in Asia/Bangkok explicitly rather than through the process TZ: a due
 * date is a plain DATE and must not become the previous day because a runtime
 * somewhere decided to be UTC (the ADR-009 failure, in miniature).
 */
function thaiDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const year = (get('year') + 543) % 100;
  return `${get('day')} ${THAI_MONTHS[get('month') - 1]} ${String(year).padStart(2, '0')}`;
}

/**
 * One template per event LINE is allowed to carry.
 *
 * Partial over the event union rather than total: `payment_rejected` and
 * `contract_expiring` must NOT have one — they are born `skipped` in emit.ts,
 * and a template here would be a message rule 15 forbids. The two sets are
 * reconciled at module load, below.
 */
type Template = (input: LineMessageInput) => string;

const TEMPLATES: Partial<Record<NotificationEvent, Template>> = {
  bill_issued: ({ amount, dueDate }) =>
    [
      'บิลใหม่ประจำเดือน',
      field('ยอดชำระ', amount === null ? null : baht(amount)),
      field('กำหนดชำระ', dueDate === null ? null : thaiDate(dueDate)),
      'ดูรายละเอียดและแจ้งชำระเงินได้ในแอปค่ะ',
    ]
      .filter(Boolean)
      .join('\n'),

  payment_verified: ({ amount }) =>
    [
      'ยืนยันการชำระเงินแล้ว',
      field('รับชำระ', amount === null ? null : baht(amount)),
      'ขอบคุณค่ะ',
    ]
      .filter(Boolean)
      .join('\n'),

  due_reminder: ({ amount, dueDate }) =>
    [
      'ใกล้ถึงกำหนดชำระค่าเช่า',
      field('ยอดค้างชำระ', amount === null ? null : baht(amount)),
      field('กำหนดชำระ', dueDate === null ? null : thaiDate(dueDate)),
      'ชำระภายในกำหนดเพื่อไม่ให้มีค่าปรับค่ะ',
    ]
      .filter(Boolean)
      .join('\n'),

  // Rule 3: ฿50/day from the 6th. The message states the rule and never a
  // running total — the fee is live until it freezes onto the invoice, and a
  // number pushed to a phone stops being true the next morning.
  overdue: ({ amount, dueDate }) =>
    [
      'เลยกำหนดชำระค่าเช่าแล้ว',
      field('ยอดค้างชำระ', amount === null ? null : baht(amount)),
      field('ครบกำหนดเมื่อ', dueDate === null ? null : thaiDate(dueDate)),
      'มีค่าปรับวันละ ฿50 นับจากวันที่ 6 กรุณาชำระโดยเร็วค่ะ',
    ]
      .filter(Boolean)
      .join('\n'),

  // The announcement's own words are NOT carried: they are free text a person
  // typed, which is exactly what rule 15 keeps off LINE. The notice says an
  // announcement exists; the app holds what it says.
  announcement: () => 'มีประกาศใหม่จากสำนักงาน\nเปิดแอปเพื่ออ่านรายละเอียดค่ะ',
};

function field(label: string, value: string | null | undefined): string | null {
  return value ? `${label}: ${value}` : null;
}

/**
 * The message for a notification, or null if LINE may not carry this event.
 *
 * Null is not a failure: `payment_rejected` and `contract_expiring` are born
 * `skipped` in `emit.ts` precisely because no template exists for them here.
 */
export function buildLineMessage(input: LineMessageInput): string | null {
  if (!LINE_CARRIES.has(input.event)) return null;
  const template = TEMPLATES[input.event];
  return template ? template(input) : null;
}

/**
 * The two sets must agree, checked at module load rather than in a test: the
 * failure it guards against is a notification that is queued for LINE forever
 * because nothing here can render it, which a suite only catches if someone
 * thought to write that particular test. Booting loudly is better than a queue
 * that quietly never drains.
 */
for (const event of LINE_CARRIES) {
  if (!TEMPLATES[event]) {
    throw new Error(`LINE_CARRIES includes "${event}" but line/messages.ts has no template for it`);
  }
}
for (const event of Object.keys(TEMPLATES) as NotificationEvent[]) {
  if (!LINE_CARRIES.has(event)) {
    throw new Error(`line/messages.ts has a template for "${event}", which LINE_CARRIES excludes`);
  }
}
