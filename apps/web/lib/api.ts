/**
 * The thin BFF edge: everything the browser needs goes through here to Express.
 *
 * NO BUSINESS RULE LIVES IN THIS LAYER (Master Document §18.1). Late fees,
 * the no-partial-payment rule, frozen contract rent, role checks — all of it is
 * enforced in Express, where the §5 role checks and the §4 database triggers
 * back each other up. A rule written here escapes both.
 */
const BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api/v1';

/**
 * The header Express uses to hand back a slid tenant session, and the callback
 * that stores it.
 *
 * A registry rather than an import: this module is shared with the staff app
 * and must not pull the tenant session (a client module) in behind it. The
 * tenant lib registers itself; nothing else does, and no staff response carries
 * the header anyway — only `requireTenant` sets it.
 */
const TENANT_TOKEN_HEADER = 'X-Tenant-Token';
let tokenRefreshHandler: ((token: string) => void) | null = null;

export function onTokenRefresh(handler: (token: string) => void): void {
  tokenRefreshHandler = handler;
}

function takeRefreshedToken(res: Response): void {
  const token = res.headers.get(TENANT_TOKEN_HEADER);
  if (token && tokenRefreshHandler) tokenRefreshHandler(token);
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function apiFetch<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const { token, headers, ...rest } = init;

  const res = await fetch(`${BASE}${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    cache: 'no-store',
  });

  takeRefreshedToken(res);

  const body = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new ApiError(res.status, body.error ?? 'เกิดข้อผิดพลาดในระบบ');
  return body;
}

/**
 * Multipart, for the payment slip. No Content-Type header on purpose: the
 * browser has to set it itself so the multipart boundary is included.
 *
 * Client-side type and size checks are a convenience only — the server decides
 * from the file's own bytes and would reject a renamed file this never saw.
 */
export async function apiUpload<T>(path: string, form: FormData, token?: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    body: form,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    cache: 'no-store',
  });

  takeRefreshedToken(res);

  const body = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new ApiError(res.status, body.error ?? 'อัปโหลดไม่สำเร็จ');
  return body;
}

/** The message to show a user for any thrown error, API or network. */
export function errorMessage(err: unknown, fallback = 'เกิดข้อผิดพลาดในระบบ'): string {
  return err instanceof ApiError ? err.message : fallback;
}
