'use client';

import { useEffect, useState } from 'react';

export type Role = 'admin' | 'staff' | 'worker';
export interface SessionUser {
  id: string;
  name: string;
  role: Role;
}

const TOKEN_KEY = 'amanew.token';
const USER_KEY = 'amanew.user';

/**
 * sessionStorage, not localStorage: reception is a shared desk, and the token
 * is shift-length by design (JWT_EXPIRES_IN=10h). Closing the browser should
 * end the shift's session rather than leave it signed in for the next person.
 *
 * The token is a convenience for the UI only — every permission decision is
 * made again in Express against the token's claims. Nothing here is a check.
 */
export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setSession(token: string, user: SessionUser): void {
  sessionStorage.setItem(TOKEN_KEY, token);
  sessionStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession(): void {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
}

export function getUser(): SessionUser | null {
  if (typeof window === 'undefined') return null;
  const raw = sessionStorage.getItem(USER_KEY);
  return raw ? (JSON.parse(raw) as SessionUser) : null;
}

/** null while loading, then the user — or null forever if not signed in. */
export function useSession(): { user: SessionUser | null; loaded: boolean } {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setUser(getUser());
    setLoaded(true);
  }, []);

  return { user, loaded };
}
