import type { NextFunction, Request, Response } from 'express';

/**
 * Error convention — Master Document §5.
 *   400 validation      401 not authenticated      403 authenticated but not allowed
 *   409 every constraint/trigger rejection, as a human-readable message
 * A raw Postgres error string never reaches the client, and neither does a
 * body-parser one: 413/415 below are the two cases where a body we could not
 * read has a more precise answer than 400.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (m: string, d?: unknown) => new AppError(400, m, d);
export const unauthorized = (m = 'ไม่ได้เข้าสู่ระบบ') => new AppError(401, m);
export const forbidden = (m = 'คุณไม่มีสิทธิ์ใช้งานส่วนนี้') => new AppError(403, m);
export const notFound = (m = 'ไม่พบข้อมูล') => new AppError(404, m);
export const conflict = (m: string) => new AppError(409, m);

/** Postgres codes that mean "the database refused this", i.e. a 409 not a 500. */
const CONSTRAINT_CODES = new Set([
  '23505', // unique_violation
  '23P01', // exclusion_violation — ADR-002 booking overlap
  '23514', // check_violation
  '23503', // foreign_key_violation
  'P0001', // raise_exception — every guard trigger in db/migrations
]);

/**
 * Digging the Postgres code out is fiddlier than it looks. A failed `$queryRaw`
 * arrives as a PrismaClientKnownRequestError whose own `code` is `P2010`
 * ("raw query failed") — Prisma's code, not Postgres's. The real SQLSTATE is in
 * `meta.code`, or failing that embedded in the message as "Code: `23P01`".
 *
 * Reading `err.code` alone therefore sees P2010, matches nothing, and every
 * constraint violation in the system falls through to a 500.
 */
function pgCode(err: unknown): string | undefined {
  const e = err as { code?: string; meta?: { code?: string }; message?: string };

  if (e?.meta?.code) return e.meta.code;
  // A SQLSTATE is five alphanumerics starting with a digit; Prisma's own codes
  // start with "P", so this tells the two apart without a list.
  if (e?.code && /^\d[0-9A-Z]{4}$/.test(e.code)) return e.code;

  return typeof e?.message === 'string' ? /Code:\s*`([0-9A-Z]{5})`/.exec(e.message)?.[1] : undefined;
}

/** A trigger's RAISE text, which is written for a human, unlike a raw SQLSTATE dump. */
function triggerMessage(err: unknown): string | undefined {
  const e = err as { meta?: { message?: string }; message?: string };
  const raw = e?.meta?.message ?? e?.message;
  if (typeof raw !== 'string') return undefined;

  // "Message: `ERROR: Only admin users may verify payments`" → the sentence.
  const match = /Message:\s*`(?:ERROR:\s*)?([^`]+)`/.exec(raw) ?? /^ERROR:\s*(.+)$/m.exec(raw);
  return match?.[1]?.trim();
}

/**
 * A trigger's own RAISE message is written for a human and is safe to surface;
 * a bare unique/exclusion violation is not, so it gets a generic sentence.
 */
export function fromDatabaseError(err: unknown, fallback: string): AppError | undefined {
  const code = pgCode(err);
  if (!code || !CONSTRAINT_CODES.has(code)) return undefined;
  const message = code === 'P0001' ? (triggerMessage(err) ?? fallback) : fallback;
  return new AppError(409, message);
}

/**
 * `express.json()`'s own failures — a body we could not read.
 *
 * body-parser throws a `SyntaxError` for malformed JSON, and without this it
 * fell through to the generic branch below: **every endpoint in the system
 * answered 500 to a bad body**, blaming the server for the client's request and
 * logging it as unhandled. Found on 2026-08-22 while probing production, where
 * `/auth/login` and a route added that same day did it identically — so it was
 * never about any one endpoint.
 *
 * Matched on body-parser's `type`, not on `instanceof SyntaxError`: a JSON.parse
 * failure anywhere in our own code is a real bug and must keep its 500.
 *
 * The messages are ours, in Thai like every other one. body-parser's own
 * ("Unexpected token g in JSON at position 0") is English, technical, and
 * describes our parser rather than anything the caller can act on.
 */
const BODY_ERRORS: Record<string, [number, string]> = {
  'entity.parse.failed': [400, 'รูปแบบข้อมูลที่ส่งมาไม่ถูกต้อง'],
  'entity.verify.failed': [400, 'ตรวจสอบข้อมูลที่ส่งมาไม่ผ่าน'],
  'request.aborted': [400, 'การเชื่อมต่อถูกยกเลิกก่อนส่งข้อมูลครบ'],
  'request.size.invalid': [400, 'ขนาดข้อมูลที่ส่งมาไม่ถูกต้อง'],
  'entity.too.large': [413, 'ข้อมูลที่ส่งมามีขนาดใหญ่เกินกำหนด'],
  'encoding.unsupported': [415, 'รูปแบบการเข้ารหัสข้อมูลไม่รองรับ'],
  'charset.unsupported': [415, 'ชุดอักขระที่ส่งมาไม่รองรับ'],
};

function fromBodyError(err: unknown): AppError | undefined {
  const type = (err as { type?: unknown })?.type;
  if (typeof type !== 'string') return undefined;
  const known = BODY_ERRORS[type];
  return known ? new AppError(known[0], known[1]) : undefined;
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
    return;
  }

  // Before the database branch: a body that never parsed never reached a query,
  // so it cannot be a constraint violation.
  const body = fromBodyError(err);
  if (body) {
    res.status(body.status).json({ error: body.message });
    return;
  }

  const mapped = fromDatabaseError(err, 'ข้อมูลขัดแย้งกับข้อมูลที่มีอยู่ในระบบ');
  if (mapped) {
    res.status(409).json({ error: mapped.message });
    return;
  }

  console.error('[unhandled]', err);
  res.status(500).json({ error: 'เกิดข้อผิดพลาดในระบบ' });
}
