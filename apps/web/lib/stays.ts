'use client';

import { apiFetch } from './api';
import { getToken } from './session';

function auth() {
  return getToken() ?? undefined;
}

function send<T>(path: string, body: unknown) {
  return apiFetch<T>(path, { method: 'POST', token: auth(), body: JSON.stringify(body) });
}

/** ADR-013: one identity behind every stay. Phone is the universal key. */
export interface Tenant {
  id: string;
  full_name: string;
  phone: string;
}

export function lookupTenant(phone: string) {
  return apiFetch<{ tenant: Tenant }>(`/tenants?phone=${encodeURIComponent(phone)}`, { token: auth() });
}

export function createTenant(body: { full_name: string; phone: string; national_id?: string }) {
  return send<{ tenant: Tenant }>('/tenants', body);
}

/** Rule 11: รายเดือน. The rent comes from the room and is frozen at signing. */
export function createTenancy(body: {
  room_id: string;
  tenant_id: string;
  start_date: string;
  agreed_months: number;
  deposit_amount?: number;
  monthly_rent?: number;
}) {
  return send<{ tenancy: { id: string; monthly_rent: number; rent_overridden: boolean } }>('/tenancies', body);
}

export function fetchTenancy(id: string) {
  return apiFetch<{
    tenancy: {
      id: string;
      room_number: string;
      room_type_label: string;
      /** The person, not the contract — S04 issues their app link code against it. */
      tenant_id: string;
      tenant_name: string;
      tenant_phone: string;
      start_date: string;
      status: string;
      monthly_rent: number;
      rent_overridden: boolean;
      agreed_months: number;
      deposit_amount: number;
      room_current_price: number;
    };
  }>(`/tenancies/${id}`, { token: auth() });
}

/** Rule 11: รายวัน. Nightly rate comes from the room type, same as above. */
export function createBooking(body: {
  room_id: string;
  tenant_id: string;
  check_in_date: string;
  check_out_date: string;
}) {
  return send<{ booking: { id: string; nightly_rate: number; rate_overridden: boolean } }>('/bookings', body);
}

export function fetchBooking(id: string) {
  return apiFetch<{
    booking: {
      id: string;
      room_number: string;
      tenant_name: string;
      tenant_phone: string;
      check_in_date: string;
      check_out_date: string;
      nightly_rate: number;
      key_deposit: number;
      status: string;
    };
  }>(`/bookings/${id}`, { token: auth() });
}

/**
 * ADR-011 / rule 5: the guest registration is written in the same transaction
 * as the check-in, so there is no way to check a guest in without it — which is
 * why S12 has no skip button. มัดจำกุญแจ is collected here and is a different
 * species of money from เงินประกัน; the two are never summed.
 */
export function checkIn(bookingId: string, body: {
  key_deposit: number;
  guest_nationality: string;
  guest_id_type: 'thai_id' | 'passport' | 'driving_license';
  guest_id_number: string;
  guest_address: string;
}) {
  return send<{ booking: { id: string; status: string } }>(`/bookings/${bookingId}/check-in`, body);
}

/** Rule 4.12: a contract ends by completion, early termination or absconding —
 *  never by a button that means "delete". This is the move-out. */
export function endTenancy(id: string, end_date?: string) {
  return send<{ tenancy: { id: string; status: string; end_date: string } }>(`/tenancies/${id}/end`, {
    ...(end_date ? { end_date } : {}),
  });
}

export function checkOutBooking(id: string, refund_key_deposit: boolean, key_deposit_deducted = 0) {
  return send<{
    booking: { id: string; status: string; key_deposit_refunded: boolean; key_deposit_refund: number };
  }>(`/bookings/${id}/check-out`, { refund_key_deposit, key_deposit_deducted });
}

/** Rule 8: a no-show is a manual act with forfeit, never an automatic timer. */
export function cancelBooking(id: string, no_show: boolean) {
  return send<{ booking: { id: string; status: string } }>(`/bookings/${id}/cancel`, { no_show });
}

export interface TodayBoard {
  arrivals: {
    id: string; room_number: string; tenant_name: string; tenant_phone: string;
    check_in_date: string; check_out_date: string; nightly_rate: number;
  }[];
  departures: { id: string; room_number: string; tenant_name: string; check_out_date: string; key_deposit: number }[];
  expiring: {
    id: string; room_number: string; tenant_name: string; tenant_phone: string;
    ends_on: string; days_left: number; agreed_months: number;
  }[];
  pending_verifications: number;
  overdue_invoices: number;
}

export function fetchToday() {
  return apiFetch<TodayBoard>('/dashboard/today', { token: auth() });
}

export interface RenewalPreview {
  tenancy: {
    id: string;
    status: string;
    room_number: string;
    room_type_label: string;
    tenant_name: string;
    tenant_phone: string;
    start_date: string;
    agreed_months: number;
    monthly_rent: number;
    deposit_amount: number;
    /** The room's price today. A renewal is where it may differ from the contract's. */
    standard_rent: number;
    ends_on: string;
    days_left: number;
    renewed_into: { id: string; start_date: string; agreed_months: number; monthly_rent: number } | null;
    renewed_from: { id: string; start_date: string } | null;
  };
  outstanding_invoices: number;
}

export function fetchRenewal(tenancyId: string) {
  return apiFetch<RenewalPreview>(`/tenancies/${tenancyId}/renewal`, { token: auth() });
}

/** Rule 4.8: this creates a NEW contract and closes the old one. Never an extension. */
export function renewTenancy(tenancyId: string, body: {
  agreed_months: number;
  monthly_rent?: number;
  start_date?: string;
}) {
  return send<{
    tenancy: { id: string; start_date: string; agreed_months: number; monthly_rent: number; deposit_amount: number };
    previous_ended_on: string;
  }>(`/tenancies/${tenancyId}/renew`, body);
}

export interface CheckoutPreview {
  tenancy: {
    id: string;
    status: string;
    room_number: string;
    tenant_name: string;
    tenant_phone: string;
    start_date: string;
    agreed_months: number;
    agreed_until: string;
    /** Rule 12: measured against the agreed term, decided by bangkok_today(). */
    is_early: boolean;
    days_remaining: number;
    monthly_rent: number;
    deposit_amount: number;
  };
  outstanding: {
    id: string;
    invoice_number: string;
    billing_period: string;
    status: string;
    total_amount: number;
    amount_due: number;
  }[];
  outstanding_total: number;
  meters: { meter_type: 'electric' | 'water'; previous_reading: number | null; rate: number }[];
  policy: { cleaning_fee: number; late_fee_per_day: number };
  settlement: Settlement | null;
}

export interface Settlement {
  deposit_amount: number;
  cleaning_fee: number;
  damage_amount: number;
  outstanding_amount: number;
  deposit_forfeited: boolean;
  forfeit_reason: string | null;
  refund_amount: number;
  /** Shown struck through. Rule 4: never collected, and stored nowhere as debt. */
  excess_waived: number;
  settled_at?: string;
}

export function fetchCheckout(tenancyId: string) {
  return apiFetch<CheckoutPreview>(`/tenancies/${tenancyId}/checkout`, { token: auth() });
}

export function settleCheckout(tenancyId: string, body: {
  damage_amount: number;
  cleaning_fee?: number;
  forfeit_deposit?: boolean;
  forfeit_reason?: string;
  final_readings?: { meter_type: 'electric' | 'water'; new_reading: number; is_estimated?: boolean }[];
  final_billing_period?: string;
  notes?: string;
}) {
  return send<{ settlement: Settlement; outstanding_invoices: number }>(`/tenancies/${tenancyId}/checkout`, body);
}

export type MeterType = 'electric' | 'water';

export interface MeterState {
  previous_reading: number | null;
  prior_tenant_close: number | null;
  is_opening: boolean;
  recorded: {
    id: string;
    old_reading: number;
    new_reading: number;
    computed_cost: number;
    is_estimated: boolean;
  } | null;
}

export interface MeterRow {
  tenancy_id: string;
  room_number: string;
  floor: number;
  tenant_name: string;
  meters: Record<MeterType, MeterState>;
}

export function fetchPendingMeters(period: string) {
  return apiFetch<{ tenancies: MeterRow[]; total: number; complete: number }>(
    `/meter-readings/pending?reading_period=${period}`,
    { token: auth() },
  );
}

export function saveReadings(tenancyId: string, body: {
  reading_period: string;
  readings: {
    meter_type: MeterType;
    old_reading?: number;
    new_reading: number;
    is_estimated?: boolean;
    confirm_opening?: boolean;
    meter_replaced?: boolean;
  }[];
}) {
  return send<{ readings: { id: string; meter_type: MeterType; computed_cost: number }[] }>(
    `/tenancies/${tenancyId}/meter-readings`,
    body,
  );
}

export function fetchReading(id: string) {
  return apiFetch<{
    reading: {
      id: string;
      meter_type: MeterType;
      reading_period: string;
      old_reading: string;
      new_reading: string;
      rate: string;
      computed_cost: string;
      is_estimated: boolean;
      entered_at: string;
      corrections: {
        corrected_old_reading: string;
        corrected_new_reading: string;
        reason: string;
        corrected_at: string;
      }[];
    };
  }>(`/meter-readings/${id}`, { token: auth() });
}

/** S15, admin only. Append-only (ADR-006): the original row is never touched. */
export function correctReading(id: string, body: {
  corrected_old_reading: number;
  corrected_new_reading: number;
  reason: string;
}) {
  return send<{ correction: { id: string; corrected_at: string } }>(`/meter-readings/${id}/correct`, body);
}

export const METER_LABEL: Record<MeterType, string> = { electric: 'ไฟฟ้า', water: 'น้ำ' };

/**
 * S37 — ย้ายห้อง. Never-violate rule 13 / Business Rules 10.1–10.4.
 *
 * `previous_electric` / `previous_water` are null only when the contract has no
 * reading in its current room yet — a transfer inside the move-in month. The
 * screen then has to ask for the opening value instead of pre-filling it, and
 * the endpoint requires it: ADR-008 says an opening comes off the meter.
 */
export interface TransferPreview {
  preview: {
    tenancy_id: string;
    status: string;
    start_date: string;
    monthly_rent: number;
    deposit_amount: number;
    agreed_months: number;
    from_room_id: string;
    from_room_number: string;
    from_type_key: string;
    from_type_label: string;
    tenant_name: string;
    tenant_phone: string;
    previous_electric: number | null;
    previous_water: number | null;
    today: string;
  };
}

export function fetchTransferPreview(tenancyId: string) {
  return apiFetch<TransferPreview>(`/tenancies/${tenancyId}/transfer-preview`, { token: auth() });
}

/** Same contract, same rent, deposit carried. None of those are parameters here. */
export function transferRoom(
  tenancyId: string,
  body: {
    to_room_id: string;
    transferred_on: string;
    reason?: string;
    closing_electric: number;
    closing_water: number;
    opening_electric: number;
    opening_water: number;
    from_opening_electric?: number;
    from_opening_water?: number;
    confirm_opening?: boolean;
  },
) {
  return send<{
    transfer: {
      tenancy_id: string;
      from_room: string;
      to_room: string;
      transferred_on: string;
      billing_period: string;
      room_type_changed: boolean;
      monthly_rent: number;
    };
  }>(`/tenancies/${tenancyId}/transfer`, body);
}
