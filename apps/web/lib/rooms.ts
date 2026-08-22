'use client';

import { apiFetch } from './api';
import { getToken } from './session';

export type RoomStatus = 'vacant' | 'occupied_monthly' | 'occupied_daily' | 'reserved';

/** The staff/admin shape. Workers get a different, smaller one from the API. */
export interface Room {
  id: string;
  room_number: string;
  floor: number;
  rental_type: 'monthly' | 'daily';
  room_type: 'single' | 'double';
  room_type_label: string;
  status: RoomStatus;
  rent: number;
  nightly: number;
  price_overridden: boolean;
  tenancy_id: string | null;
  booking_id: string | null;
  occupant: { name: string; phone: string | null } | null;
}

export interface WorkerRoom {
  room_number: string;
  floor: number;
  rental_type: 'monthly' | 'daily';
  occupied: boolean;
}

export interface RoomsSummary {
  total: number;
  vacant: number;
  occupied: number;
  reserved: number;
  monthly: number;
  daily: number;
}

export function fetchRooms() {
  return apiFetch<{ rooms: Room[]; summary: RoomsSummary }>('/dashboard/rooms', {
    token: getToken() ?? undefined,
  });
}

export function fetchWorkerRooms() {
  return apiFetch<{ rooms: WorkerRoom[] }>('/dashboard/rooms', { token: getToken() ?? undefined });
}

/** The room grid distinguishes three states; the four API statuses fold into them. */
export function stateClass(status: RoomStatus): string {
  if (status === 'vacant') return 'state-vacant';
  if (status === 'reserved') return 'state-reserved';
  return 'state-occupied';
}

export const ROOM_TYPE_ICON: Record<Room['room_type'], string> = {
  single: '🛏',
  double: '🛏🛏',
};
