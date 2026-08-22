'use client';

import { apiFetch, onTokenRefresh } from './api';
import type { Invoice, InvoiceTransfer, UtilityLine } from './billing';
import { getTenantToken, saveRefreshedTenantToken } from './tenant-session';

// The session slides: Express re-signs a token older than a day and returns it
// in `X-Tenant-Token`, so a tenant who opens the app at all never has to come
// to the office for another code. Registered here rather than per page —
// every `/t` screen imports this module, and none of them should have to know.
onTokenRefresh(saveRefreshedTenantToken);

/**
 * The tenant app's calls. Same rule as every other lib here: no business logic
 * (Master Document §18.1) — Express decides what a tenant may see, and the
 * token's own `sub` decides whose data it is. Nothing below sends a tenant id.
 */
function auth() {
  return getTenantToken() ?? undefined;
}

export interface TenantMe {
  id: string;
  full_name: string;
  phone: string;
  line_linked: boolean;
  tenancy_id: string | null;
  start_date: string | null;
  end_date: string | null;
  agreed_months: number | null;
  monthly_rent: number | null;
  deposit_amount: number | null;
  room_number: string | null;
  room_type_name: string | null;
}

export type NotificationEvent =
  | 'bill_issued'
  | 'payment_verified'
  | 'payment_rejected'
  | 'announcement'
  | 'due_reminder'
  | 'overdue'
  | 'contract_expiring';

export interface TenantNotification {
  id: string;
  event: NotificationEvent;
  ref_id: string;
  title: string;
  body: string;
  amount: number | null;
  due_date: string | null;
  created_at: string;
  read_at: string | null;
  line_status: 'pending' | 'sending' | 'sent' | 'skipped' | 'failed';
}

export interface NotificationPref {
  event: NotificationEvent;
  enabled: boolean;
  /** false when the tenant has never chosen — the value shown is the default. */
  chosen: boolean;
}

/** The only unauthenticated tenant call: a code from the office becomes a session. */
export function redeemCode(code: string) {
  return apiFetch<{ token: string; tenant: { id: string; full_name: string } }>('/tenant/auth/redeem', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

export function fetchTenantMe() {
  return apiFetch<{ me: TenantMe; unread_count: number }>('/tenant/me', { token: auth() });
}

export function fetchTenantInvoices() {
  return apiFetch<{ invoices: Invoice[] }>('/tenant/invoices', { token: auth() });
}

export function fetchTenantInvoice(id: string) {
  return apiFetch<{
    invoice: Invoice;
    utility_lines: UtilityLine[];
    status_history: unknown[];
    transfers: InvoiceTransfer[];
  }>(
    `/tenant/invoices/${id}`,
    { token: auth() },
  );
}

export function fetchTenantNotifications() {
  return apiFetch<{ notifications: TenantNotification[] }>('/tenant/notifications', { token: auth() });
}

export function markNotificationRead(id: string) {
  return apiFetch<{ notification: { id: string; read_at: string } }>(`/tenant/notifications/${id}/read`, {
    method: 'POST',
    token: auth(),
  });
}

export function fetchNotificationPrefs() {
  return apiFetch<{ prefs: NotificationPref[] }>('/tenant/notification-prefs', { token: auth() });
}

export function saveNotificationPref(event: NotificationEvent, enabled: boolean) {
  return apiFetch<{ pref: NotificationPref }>('/tenant/notification-prefs', {
    method: 'PUT',
    token: auth(),
    body: JSON.stringify({ event, enabled }),
  });
}
