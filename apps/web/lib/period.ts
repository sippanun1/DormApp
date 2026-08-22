/**
 * Periods and "today", always in Asia/Bangkok.
 *
 * The browser's clock may be on any timezone; the invoice's due date and the
 * late fee are not. Same reasoning as bangkok_today() in the database
 * (ADR-009): a laptop an hour off must not shift a billing period by a month.
 */
const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/** YYYY-MM-DD in Bangkok, whatever the viewer's timezone is. */
export function bangkokToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** A billing/reading period is always the first of its month. */
export function currentPeriod(): string {
  return `${bangkokToday().slice(0, 7)}-01`;
}

/** "2026-07-01" → "ก.ค. 69" — the label staff recognise on every screen. */
export function periodLabel(period: string): string {
  const [year, month] = period.split('-').map(Number);
  const be = ((year ?? 0) + 543) % 100;
  return `${THAI_MONTHS[(month ?? 1) - 1]} ${String(be).padStart(2, '0')}`;
}

/** The last `count` periods, newest first — the month pickers' options. */
export function recentPeriods(count = 12): string[] {
  const [y, m] = currentPeriod().split('-').map(Number);
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const date = new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1 - i, 1));
    out.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`);
  }
  return out;
}
