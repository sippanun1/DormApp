import { Prisma } from '@prisma/client';
import { randomInt } from 'node:crypto';
import { prisma } from '../db/prisma.js';

/**
 * The staff-issued link code — the tenant's whole identity proof (Phase 2, and
 * still the only one: the 2026-08-21 decision keeps LINE out of authentication
 * entirely).
 *
 * It lives here rather than in a route file because two callers redeem it: the
 * browser at `POST /tenant/auth/redeem`, and a tenant sending the same six
 * characters to the Official Account. That sharing is why migration 011 exists:
 * under 010 the code was single-use, so spending it in one place made the other
 * impossible and being set up on both app and LINE cost two codes.
 *
 * **The code is now a setup token, not a login** (ADR-021,
 * docs/TENANT_ACCESS_PLAN.md). It works any number of times inside a window —
 * seven days by default, never past the end of the tenancy it opens — and then
 * dies for good. One slip links the phone, the laptop and LINE.
 *
 * What that gives up, stated plainly: under 010 a slip found in a bin after
 * redemption was worthless. It is now worth whatever is left of the window.
 * What replaces single-use as the guarantee is the short hard expiry, the
 * revoke button on S04/S44, and the database-side cap at the contract term
 * (011's `trg_tenant_link_codes_horizon`). What it is NOT allowed to become is
 * a standing credential: see D2 in the plan for why a reusable-for-the-contract
 * code would be a password with worse storage.
 */

// Crockford-ish: no O/0, no I/1, no S/5 — this is read aloud across a desk and
// written on paper. The CHECK in migration 010 holds the same alphabet, so a
// code that could not have come from here cannot be stored.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;

/** Used when `tenant_link_code_days` is missing, so issuing never depends on the seed. */
export const CODE_WINDOW_DAYS_DEFAULT = 7;

/** Whether a scrap of text could be a code at all — used to tell a code from chatter. */
export function looksLikeCode(text: string): boolean {
  return new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`).test(text.trim().toUpperCase());
}

export function generateCode(): string {
  // randomInt, not Math.random: this is the whole credential.
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

/**
 * The owner's window (S43), in days. Read per issue rather than cached: it is
 * one indexed lookup on a table the settings screen already reads, and a cached
 * copy would mean a policy change silently not taking effect until a restart.
 */
export async function linkCodeWindowDays(): Promise<number> {
  const rows = await prisma.$queryRaw<{ value: string }[]>`
    SELECT value FROM system_settings WHERE key = 'tenant_link_code_days'`;
  const parsed = Number(rows[0]?.value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : CODE_WINDOW_DAYS_DEFAULT;
}

export interface ClaimedTenant {
  tenant_id: string;
  full_name: string;
}

/** Thrown when the LINE account is already bound to a *different* tenant (010's unique index). */
export class LineAccountTakenError extends Error {}

/**
 * Thrown when the *tenant* is already bound to a different LINE account.
 *
 * This is a hazard multi-use created and single-use did not have: while a code
 * stays live, a second person could send it from their own LINE and take over
 * where the tenant's bill notices go. `uq_tenants_line_user` does not stop it —
 * that index stops one account claiming two tenants, not two accounts claiming
 * one. So the bind is first-wins (ADR-021 D5), and switching LINE accounts
 * needs a fresh code from the desk.
 */
export class TenantAlreadyBoundError extends Error {}

interface ClaimRow extends ClaimedTenant {
  /** False only in the D5 case: the statement matched a code but refused the bind. */
  line_ok: boolean;
}

/**
 * Redeem a code and return whose it was, or null if it was wrong, expired or
 * revoked.
 *
 * The claim is still ONE statement. What changed from 010 is only the predicate
 * — `used_at IS NULL` became `revoked_at IS NULL` — and the fact that
 * `redemptions` counts up instead of the row being spent. The concurrency
 * argument is unchanged and still load-bearing: two taps on a slow phone are
 * two concurrent requests, and the counter is correct because the UPDATE holds
 * the row lock, not because anything read the row first.
 *
 * Three side effects ride in the same statement rather than following it, for
 * the reason 009 gives about notifications: a link that a crash could lose is
 * not a link.
 *
 *   * `redemptions` / `first_used_at` on the code;
 *   * `tenants.app_linked_at` when a browser redeems — this is what the
 *     เชื่อมแอปแล้ว badge reads, and giving it its own column is what stops a
 *     LINE bind from lighting it (migration 011);
 *   * `tenants.line_user_id` when LINE redeems, and only if it is still free.
 *
 * The transaction exists for exactly one case: a refused bind must not spend a
 * redemption, so the throw rolls the counter back with it.
 */
export async function claimLinkCode(code: string, lineUserId?: string): Promise<ClaimedTenant | null> {
  const normalised = code.trim().toUpperCase();
  const line = lineUserId ?? null;

  try {
    return await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<ClaimRow[]>`
        WITH claimed AS (
          UPDATE tenant_link_codes
          SET first_used_at = COALESCE(first_used_at, now()),
              redemptions   = redemptions + 1,
              -- The first LINE account to use this code is the one recorded on
              -- it; later browser redemptions must not blank that out.
              used_by_line_user_id = COALESCE(used_by_line_user_id, ${line})
          WHERE code = ${normalised} AND expires_at > now() AND revoked_at IS NULL
          RETURNING tenant_id
        ), app AS (
          -- Browser redemption only. A LINE bind is not a device session, which
          -- is the whole of defect 2 in migration 011's header.
          UPDATE tenants t SET app_linked_at = now()
          FROM claimed c
          WHERE t.id = c.tenant_id AND ${line}::text IS NULL
          RETURNING t.id
        ), bound AS (
          -- The IS NULL test is re-evaluated under the row lock, so if a
          -- concurrent redemption bound it first this matches nothing. That is
          -- what makes first-wins true rather than merely likely.
          UPDATE tenants t SET line_user_id = ${line}
          FROM claimed c
          WHERE t.id = c.tenant_id AND ${line}::text IS NOT NULL AND t.line_user_id IS NULL
          RETURNING t.id
        )
        SELECT c.tenant_id, t.full_name,
               (${line}::text IS NULL
                 OR t.line_user_id IS NOT DISTINCT FROM ${line}::text
                 OR EXISTS (SELECT 1 FROM bound)) AS line_ok
        FROM claimed c JOIN tenants t ON t.id = c.tenant_id`;

      const row = rows[0];
      if (!row) return null;
      // `t.line_user_id` above is the pre-UPDATE snapshot, so `line_ok` is true
      // when the account was free, or was already this same one (re-sending the
      // code from the same phone is idempotent, not an error).
      if (line !== null && !row.line_ok) throw new TenantAlreadyBoundError();
      return { tenant_id: row.tenant_id, full_name: row.full_name };
    });
  } catch (err) {
    // 010's `uq_tenants_line_user`: one LINE account cannot claim two tenants.
    // The redemption is NOT counted — the whole transaction rolls back — so the
    // tenant can try again from the right account.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2010') {
      if (String(err.meta?.message ?? err.message).includes('uq_tenants_line_user')) {
        throw new LineAccountTakenError();
      }
    }
    throw err;
  }
}
