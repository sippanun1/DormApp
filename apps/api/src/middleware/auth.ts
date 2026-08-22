import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../db/prisma.js';
import { env } from '../env.js';
import { forbidden, unauthorized } from '../http/errors.js';

export type Role = 'admin' | 'staff' | 'worker';

export interface AuthUser {
  id: string;
  name: string;
  role: Role;
}

/** A tenant, from a `typ: 'tenant'` token. `id` is a `tenants.id`, never a `users.id`. */
export interface AuthTenant {
  id: string;
  name: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      tenant?: AuthTenant;
    }
  }
}

/**
 * Two kinds of token are signed with the same secret, so the kind has to be
 * inside the signature. `typ` is that claim.
 *
 * A staff token is `typ: 'staff'`; a tenant token is `typ: 'tenant'` and its
 * `sub` is a `tenants.id`, which is a different table from `users.id`. Before
 * this claim existed, `requireAuth` read `payload.role` off whatever verified
 * — so any future tenant token would have been accepted as staff with an
 * `undefined` role, and `requirePermission` would then have run a lookup
 * against a tenant UUID in `user_permissions`. Rejecting the wrong kind is
 * therefore not the same as failing to find a permission for it, and the two
 * middlewares below each reject the other's tokens outright.
 */
export type TokenType = 'staff' | 'tenant';

export function signToken(user: AuthUser): string {
  return jwt.sign({ sub: user.id, name: user.name, role: user.role, typ: 'staff' }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
  } as jwt.SignOptions);
}

/**
 * A tenant session. Longer-lived than a staff one on purpose: the only way to
 * get a first one is to walk into the office for a code, so a 10-hour expiry
 * would lock a tenant out of their own bills overnight. It is a read-mostly
 * session — nothing a tenant token can reach moves money.
 *
 * Thereafter it slides, but only while the tenancy runs: `requireTenant`
 * re-signs a token older than a day for a tenant who still lives here, so the
 * 30 days count from last use rather than from the desk (ADR-021 D4).
 */
export function signTenantToken(tenant: AuthTenant): string {
  return jwt.sign({ sub: tenant.id, name: tenant.name, typ: 'tenant' }, env.JWT_SECRET, {
    expiresIn: env.TENANT_JWT_EXPIRES_IN,
  } as jwt.SignOptions);
}

/** Staff, owner and worker routes. Rejects a tenant token rather than mis-reading it. */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next(unauthorized());

  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(header.slice(7), env.JWT_SECRET) as jwt.JwtPayload;
  } catch {
    return next(unauthorized('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่'));
  }

  // A tenant token verifies — same secret — so this check is the only thing
  // standing between a tenant and every staff route. Tokens signed before
  // `typ` existed have none; they are staff tokens by construction (no tenant
  // token could exist yet) and stay valid until they expire.
  if (payload.typ === 'tenant') return next(forbidden('บัญชีผู้เช่าใช้ส่วนนี้ไม่ได้'));

  const role = payload.role as Role | undefined;
  if (!role) return next(unauthorized());

  req.user = { id: String(payload.sub), name: String(payload.name), role };
  next();
}

/**
 * How stale a tenant token may get before a request hands back a fresh one.
 *
 * The session slides rather than running down: a tenant who opens the app even
 * once a month never expires, and only a genuinely dormant one has to come to
 * the office for another code. Without this, every tenant walks in monthly to
 * look at their own bill, which is how a self-service app stops being used.
 *
 * That margin was thinner than it looked. Bills are due on the 5th (the late
 * fee starts on the 6th, Rule 3), so a tenant who pays on the 3rd of each month
 * is 28 to 31 days between visits — a flat 30-day expiry lands almost exactly
 * on the cadence it is meant to cover, and in a 31-day month it has already
 * lapsed. Sliding is what makes it safe, so sliding has to be reliable.
 *
 * A day, not every request: re-signing costs nothing but a token that changes
 * on every call makes the client's stored value a moving target for no gain.
 */
const TENANT_TOKEN_REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;

/** The response header that carries a slid session. Exposed to the browser by CORS. */
export const TENANT_TOKEN_HEADER = 'X-Tenant-Token';

/**
 * The tenant app (`/api/v1/tenant/*`). The mirror image: a staff token is
 * refused here, so a staff session cannot be pointed at a tenant endpoint and
 * read as though `sub` were a tenant id — `sub` would be a `users.id`, and
 * every query below scopes by it.
 *
 * Also slides the session: a token older than a day is re-signed and returned
 * in `X-Tenant-Token`. Rotation is not revocation — the old token stays valid
 * until its own expiry, which is the same exposure a 30-day token already has,
 * and the alternative is a session table for a read-only view of one's own
 * bills.
 *
 * **Sliding stops when the tenancy does** (ADR-021 D4). It does not cut access
 * off: the token already in hand runs out on its own, so a former tenant can
 * still read their final bill and receipt for up to its remaining life, which
 * is deliberate — receipts are permanent (Rule 3) and rule 4 gives a former
 * tenant nothing to owe. What stops is the renewal that would otherwise keep an
 * ex-tenant's session alive for as long as they kept opening the app.
 */
export function requireTenant(req: Request, res: Response, next: NextFunction): void {
  // The tenancy lookup below makes this async. Kept sync at the boundary so
  // Express still receives a plain middleware and every rejection reaches the
  // error handler rather than becoming an unhandled one.
  void slideAndAuthorise(req, res).then(next, next);
}

/**
 * Whether this tenant still lives here — a monthly contract that has not ended,
 * or a booking that has not been checked out.
 *
 * Only ever called on the re-sign branch, which fires at most once per day per
 * tenant. That matters: `requireTenant` is otherwise pure signature
 * verification with no database round trip, and putting a query on every tenant
 * request to answer a question that changes twice a year would be a poor trade.
 */
async function tenancyIsCurrent(tenantId: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ current: boolean }[]>`
    SELECT (
      EXISTS (SELECT 1 FROM tenancies WHERE tenant_id = ${tenantId}::uuid AND status = 'active')
      OR EXISTS (
        SELECT 1 FROM bookings
        WHERE tenant_id = ${tenantId}::uuid AND status IN ('confirmed', 'checked_in')
      )
    ) AS current`;
  return rows[0]?.current ?? false;
}

async function slideAndAuthorise(req: Request, res: Response): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw unauthorized();

  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(header.slice(7), env.JWT_SECRET) as jwt.JwtPayload;
  } catch {
    throw unauthorized('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
  }

  if (payload.typ !== 'tenant') throw forbidden();

  const tenant = { id: String(payload.sub), name: String(payload.name) };
  req.tenant = tenant;

  // `iat` is in seconds and is set by jwt.sign on every token this issues; a
  // token without one is treated as due, not as fresh.
  const issuedAtMs = typeof payload.iat === 'number' ? payload.iat * 1000 : 0;
  if (Date.now() - issuedAtMs >= TENANT_TOKEN_REFRESH_AFTER_MS) {
    try {
      if (await tenancyIsCurrent(tenant.id)) {
        res.setHeader(TENANT_TOKEN_HEADER, signTenantToken(tenant));
      }
    } catch (err) {
      // Sliding is a convenience; the request is already authenticated. Failing
      // a tenant's bill view because this lookup hiccuped would be the worse
      // outcome, so the session simply does not slide this time.
      console.error('[tenant:slide]', err);
    }
  }
}

/**
 * §5's role checks. These are one half of the pair — the database triggers are
 * the other, and neither is allowed to be the only one (ADR-006/ADR-007).
 * Never re-implement this in the Next.js layer.
 *
 * Role answers "which audience is this". For "what may this particular person
 * do", see requirePermission below — rule 6's checkboxes.
 */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}

/** The nine delegable powers. Rule 6's five owner-only ones are absent by design. */
export type PermissionKey =
  | 'booking.manage'
  | 'tenancy.manage'
  | 'meter.record'
  | 'meter.correct'
  | 'invoice.generate'
  | 'payment.record'
  | 'reports.view'
  | 'request.manage'
  | 'announcement.send';

/**
 * Rule 6: permissions are per-person checkboxes, not roles. The seven role
 * names in the design are preset tick-combinations, and this is what actually
 * decides.
 *
 * Two deliberate absences, both of which would make a rule false if added:
 *
 *   * There is no key for payment verification. ADR-007 makes that admin-only
 *     and a database trigger enforces it independently — a checkbox that could
 *     grant it would be a second, weaker answer to the same question.
 *   * There are no keys for settings, prices, staff or the audit log. Rule 6
 *     calls those owner-only, so they stay `requireRole('admin')`.
 *
 * An admin passes every check without consulting the table: an owner is not
 * restricted by their own checkboxes, and storing a full set for them would
 * invite un-ticking one and locking the owner out of their own system.
 */
export function requirePermission(...keys: PermissionKey[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(unauthorized());
    if (req.user.role === 'admin') return next();

    // Any one of the listed keys is enough. Several screens are legitimately
    // reachable from two directions — a bill has to be readable by whoever
    // records the payment as well as by whoever generated it — and demanding
    // both would mean granting a power to allow a read.
    prisma
      .$queryRaw<{ ok: boolean }[]>`
        SELECT TRUE AS ok FROM user_permissions
        WHERE user_id = ${req.user.id}::uuid AND permission_key = ANY (${keys}::text[])
        LIMIT 1`
      .then((rows) => {
        if (!rows[0]) return next(forbidden('คุณไม่มีสิทธิ์ใช้งานส่วนนี้ — ให้เจ้าของเปิดสิทธิ์ให้ก่อน'));
        next();
      })
      .catch(next);
  };
}
