/**
 * Display conventions, in one place — every screen formats money and dates
 * through these, never with an inline template string.
 *   Money: ฿ prefix, comma thousands, no decimals  → ฿4,150
 *   Dates: Thai abbreviated month, Buddhist year    → 17 ก.ค. 69
 */
const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/**
 * Null-tolerant on purpose. An aggregate over zero rows comes back as NULL, and
 * a thrown TypeError here does not blank one figure — it unmounts the whole
 * screen (S39 was unopenable on an empty database for exactly this reason).
 * A missing amount is displayed as ฿0; the API is still responsible for not
 * sending one.
 */
export function baht(amount: number | string | null | undefined): string {
  const n = amount == null ? 0 : typeof amount === 'string' ? Number(amount) : amount;
  return `฿${(Number.isFinite(n) ? n : 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

/**
 * 2026-07-17 → "17 ก.ค. 69" (Buddhist year, last two digits).
 *
 * Rendered in Asia/Bangkok explicitly, never in the viewer's local timezone.
 * The same reason the database uses bangkok_today() instead of CURRENT_DATE
 * (ADR-009): a laptop set to another zone would otherwise show a due date that
 * disagrees with the invoice it is printed on, and late fees hang off that date.
 */
export function thaiDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;

  // en-CA gives ISO order (YYYY-MM-DD), which is trivial to split.
  const [year, month, day] = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(d)
    .split('-')
    .map(Number);

  const be = ((year ?? 0) + 543) % 100;
  return `${day} ${THAI_MONTHS[(month ?? 1) - 1]} ${String(be).padStart(2, '0')}`;
}
