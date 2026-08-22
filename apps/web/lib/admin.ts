'use client';

import { apiFetch } from './api';
import { getToken } from './session';

function auth() {
  return getToken() ?? undefined;
}

function patch<T>(path: string, body: unknown) {
  return apiFetch<T>(path, { method: 'PATCH', token: auth(), body: JSON.stringify(body) });
}

export interface RoomType {
  id: string;
  type_key: 'single' | 'double';
  name_th: string;
  bed_type: string;
  default_rent: number;
  default_nightly: number;
}

export function fetchRoomTypes() {
  return apiFetch<{ room_types: RoomType[] }>('/room-types', { token: auth() });
}

/**
 * Rule 2, at its most consequential: this moves what future contracts start at
 * and nothing else. The API says so in its own response (`affects`), and the
 * screen repeats it — a price list that looks like it re-prices sitting tenants
 * is the one misunderstanding worth spending a sentence on.
 */
export function updateRoomTypePrice(id: string, body: { default_rent?: number; default_nightly?: number }) {
  return patch<{ room_type: RoomType; affects: string }>(`/room-types/${id}`, body);
}

/** null clears the override and returns the room to its type's price (rule 11). */
export function updateRoomPrice(id: string, body: { rent_override?: number | null; nightly_override?: number | null }) {
  return patch<{ room: { id: string; room_number: string } }>(`/rooms/${id}/price`, body);
}

export interface UtilityRate {
  id: string;
  meter_type: 'electric' | 'water';
  rate: number;
  effective_from: string;
  created_by_name: string;
  is_current: boolean;
}

export function fetchRates() {
  return apiFetch<{ rates: UtilityRate[] }>('/utility-rates', { token: auth() });
}

export function addRate(body: { meter_type: 'electric' | 'water'; rate: number; effective_from: string }) {
  return apiFetch<{ rate: UtilityRate }>('/utility-rates', {
    method: 'POST',
    token: auth(),
    body: JSON.stringify(body),
  });
}

export interface Setting {
  key: string;
  value: string;
  value_type: 'int' | 'money' | 'text' | 'bool';
  updated_at: string;
  updated_by_name: string | null;
}

export function fetchSettings() {
  return apiFetch<{ settings: Setting[] }>('/settings', { token: auth() });
}

export function updateSetting(key: string, value: string) {
  return patch<{ setting: Setting }>(`/settings/${key}`, { value });
}

export interface AuditEntry {
  id: string;
  entity_type: string;
  entity_id: string | null;
  action: string;
  detail: Record<string, unknown> | null;
  created_at: string;
  actor_name: string;
  actor_role: string;
}

export function fetchAudit(entityType?: string) {
  const q = entityType ? `?entity_type=${encodeURIComponent(entityType)}` : '';
  return apiFetch<{ entries: AuditEntry[]; entity_types: { entity_type: string; count: number }[] }>(
    `/audit-log${q}`,
    { token: auth() },
  );
}

export interface DirectoryRow {
  id: string;
  full_name: string;
  phone: string;
  /** Whether this person's LINE account is bound (Phase 3). Not whether they use the app. */
  line_linked: boolean;
  current_room: string | null;
  current_tenancy_id: string | null;
  current_kind: 'monthly' | 'daily' | null;
  last_room: string | null;
  last_ended_on: string | null;
  stay_count: number;
}

export function fetchDirectory(q: string) {
  return apiFetch<{ tenants: DirectoryRow[]; count: number }>(
    `/tenants/directory${q ? `?q=${encodeURIComponent(q)}` : ''}`,
    { token: auth() },
  );
}

/**
 * S26 — rule 6's checkboxes.
 *
 * The nine keys below are the delegable powers. Payment verification is not
 * among them (ADR-007 — admin-only, backed by a database trigger), and neither
 * are settings, prices, staff management or the audit log, which rule 6 calls
 * owner-only. The server publishes the list; this type mirrors it rather than
 * defining it.
 */
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

export const PERMISSION_LABEL: Record<PermissionKey, string> = {
  'booking.manage': 'จองห้องรายวัน / เช็คอิน (S10, S12)',
  'tenancy.manage': 'ทำสัญญา ต่อสัญญา ย้ายออก (S08, S35, S27)',
  'meter.record': 'จดมิเตอร์ (S13)',
  'meter.correct': 'แก้ไขเลขมิเตอร์ที่บันทึกแล้ว (S15)',
  'invoice.generate': 'ออกบิลประจำเดือน (S16, S17)',
  'payment.record': 'บันทึกการชำระเงินและสลิป (S20)',
  'reports.view': 'ดูรายงานรายรับ (S39, S40)',
  'request.manage': 'จัดการเรื่องแจ้ง (S42)',
  'announcement.send': 'ส่งประกาศ (S41)',
};

export interface StaffMember {
  id: string;
  name: string;
  phone: string;
  role: 'admin' | 'staff' | 'worker';
  is_active: boolean;
  created_at: string;
  permissions: PermissionKey[];
}

export function fetchStaff() {
  return apiFetch<{
    staff: StaffMember[];
    permission_keys: PermissionKey[];
    presets: Record<string, PermissionKey[]>;
  }>('/staff', { token: auth() });
}

export function createStaff(body: {
  name: string;
  phone: string;
  password: string;
  role: 'admin' | 'staff' | 'worker';
  permissions: PermissionKey[];
}) {
  return apiFetch<{ user: { id: string } }>('/staff', {
    method: 'POST',
    token: auth(),
    body: JSON.stringify(body),
  });
}

export function updateStaff(id: string, body: { name?: string; is_active?: boolean; password?: string }) {
  return patch<{ user: StaffMember }>(`/staff/${id}`, body);
}

/** The whole tick list, replaced — the screen shows the complete state. */
export function setPermissions(id: string, permissions: PermissionKey[]) {
  return apiFetch<{ permissions: PermissionKey[] }>(`/staff/${id}/permissions`, {
    method: 'PUT',
    token: auth(),
    body: JSON.stringify({ permissions }),
  });
}

/**
 * Phase 5 — the staff side of the tenant app's identity.
 *
 * The code is how a tenant first gets in (Phase 2): staff read six characters
 * across the desk to a person they can see, and that is the security model.
 * All four actions need `tenancy.manage`, not owner rights — the person at the
 * desk is the one who can tell who they are talking to, and revoking is
 * strictly less dangerous than issuing.
 *
 * Since ADR-021 the code is a setup token, not a one-shot: it works for seven
 * days (never past the end of the tenancy) so one slip links the phone, the
 * laptop and LINE.
 */
export interface LinkCode {
  code: string;
  expires_at: string;
}

export interface LinkStatus {
  /** A device has redeemed a code in a browser. A LINE bind does NOT set this. */
  linked: boolean;
  /** Has bound a LINE account (Phase 3). Independent of the above. */
  line_linked: boolean;
  last_linked_at: string | null;
  /** A code is out there, unexpired and unrevoked. Issuing another revokes it. */
  code_pending: boolean;
  code_expires_at: string | null;
  /** How many times the live code has been redeemed — one per device, plus LINE. */
  code_redemptions: number;
}

export function fetchLinkStatus(tenantId: string) {
  return apiFetch<{ status: LinkStatus }>(`/tenants/${tenantId}/link-status`, { token: auth() });
}

export function issueLinkCode(tenantId: string) {
  return apiFetch<{ link_code: LinkCode; tenant: { full_name: string } }>(`/tenants/${tenantId}/link-code`, {
    method: 'POST',
    token: auth(),
  });
}

/** Add days to the live code rather than forcing a new one on a tenant mid-setup. */
export function extendLinkCode(tenantId: string, days: number) {
  return apiFetch<{ link_code: LinkCode }>(`/tenants/${tenantId}/link-code`, {
    method: 'PATCH',
    token: auth(),
    body: JSON.stringify({ days }),
  });
}

/** Kill the live code now. Existing sessions are untouched — this stops new devices. */
export function revokeLinkCode(tenantId: string) {
  return apiFetch<{ revoked: boolean }>(`/tenants/${tenantId}/link-code`, {
    method: 'DELETE',
    token: auth(),
  });
}
