'use client';

import { useEffect, useState } from 'react';

export interface TenantSession {
  id: string;
  full_name: string;
}

const TOKEN_KEY = 'amanew.tenant.token';
const TENANT_KEY = 'amanew.tenant';

/**
 * localStorage, unlike the staff session's sessionStorage — and the difference
 * is the point.
 *
 * Reception is a shared desk, so a staff token is shift-length and dies with
 * the tab. A tenant is on their own phone and cannot re-authenticate without
 * walking into the office for a new code, so their session has to survive the
 * browser closing. `TENANT_JWT_EXPIRES_IN` (30d) is the real limit; this is
 * just where it is kept.
 *
 * Still not a check. Every one of these values is re-decided in Express against
 * the token's own claims — `requireTenant` refuses anything that is not
 * `typ: 'tenant'`, and every query scopes by the `sub` inside the signature,
 * never by an id the page sends.
 */
export function getTenantToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setTenantSession(token: string, tenant: TenantSession): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(TENANT_KEY, JSON.stringify(tenant));
}

/**
 * The slid session (`X-Tenant-Token`). Only the token moves — the tenant's name
 * and id are the same person, and re-writing them would overwrite the record of
 * who redeemed the code with nothing new.
 */
export function saveRefreshedTenantToken(token: string): void {
  if (typeof window === 'undefined') return;
  // Only if a session is already here. A refreshed token arriving with no
  // stored session means the tab was logged out mid-flight; storing it would
  // resurrect a session the tenant just ended.
  if (localStorage.getItem(TOKEN_KEY)) localStorage.setItem(TOKEN_KEY, token);
}

export function clearTenantSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(TENANT_KEY);
}

export function getTenant(): TenantSession | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(TENANT_KEY);
  return raw ? (JSON.parse(raw) as TenantSession) : null;
}

/** null while loading, then the tenant — or null forever if not linked. */
export function useTenantSession(): { tenant: TenantSession | null; loaded: boolean } {
  const [tenant, setTenant] = useState<TenantSession | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setTenant(getTenant());
    setLoaded(true);
  }, []);

  return { tenant, loaded };
}
