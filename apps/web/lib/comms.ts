'use client';

import { apiFetch } from './api';
import { getToken } from './session';

function auth() {
  return getToken() ?? undefined;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  target_type: 'all' | 'floor' | 'room';
  target_floors: number[];
  target_rooms: string[];
  /** Rule 15: the optional copy. In-app has no flag because it is not optional. */
  send_line: boolean;
  sent_at: string;
  sent_by_name: string;
  occupied_rooms_now: number;
}

export function fetchAnnouncements() {
  return apiFetch<{ announcements: Announcement[] }>('/announcements', { token: auth() });
}

export function sendAnnouncement(body: {
  title: string;
  body: string;
  target_type: 'all' | 'floor' | 'room';
  target_floors?: number[];
  target_rooms?: string[];
  send_line?: boolean;
}) {
  return apiFetch<{ announcement: Announcement }>('/announcements', {
    method: 'POST',
    token: auth(),
    body: JSON.stringify(body),
  });
}

export function deleteAnnouncement(id: string) {
  return apiFetch<{ deleted: string }>(`/announcements/${id}`, { method: 'DELETE', token: auth() });
}

export type RequestType = 'repair' | 'cleaning' | 'moveout' | 'renewal';
export type RequestStatus = 'reported' | 'assigned' | 'in_progress' | 'blocked' | 'resolved';

export interface MaintenanceRequest {
  id: string;
  request_type: RequestType;
  detail: string;
  status: RequestStatus;
  assigned_to: string | null;
  note: string | null;
  reported_at: string;
  resolved_at: string | null;
  room_number: string;
  tenant_name: string | null;
  reported_by_name: string;
  hours_waiting: number;
}

export const REQUEST_TYPE_LABEL: Record<RequestType, string> = {
  repair: '🔧 แจ้งซ่อม',
  cleaning: '🧹 แจ้งทำความสะอาด',
  moveout: '📦 แจ้งย้ายออก',
  renewal: '📄 ขอต่อสัญญา',
};

export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  reported: 'ใหม่ — ยังไม่มอบหมาย',
  assigned: 'มอบหมายแล้ว',
  in_progress: 'กำลังดำเนินการ',
  blocked: 'ติดปัญหา — รอช่างข้างนอก',
  resolved: 'เสร็จแล้ว',
};

export function fetchRequests(status?: RequestStatus) {
  return apiFetch<{ requests: MaintenanceRequest[]; open_count: number }>(
    `/requests${status ? `?status=${status}` : ''}`,
    { token: auth() },
  );
}

export function createRequest(body: { room_id: string; request_type: RequestType; detail: string }) {
  return apiFetch<{ request: { id: string } }>('/requests', {
    method: 'POST',
    token: auth(),
    body: JSON.stringify(body),
  });
}

export function updateRequest(id: string, body: { status?: RequestStatus; assigned_to?: string | null; note?: string | null }) {
  return apiFetch<{ request: MaintenanceRequest }>(`/requests/${id}`, {
    method: 'PATCH',
    token: auth(),
    body: JSON.stringify(body),
  });
}
