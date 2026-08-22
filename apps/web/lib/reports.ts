'use client';

import { apiFetch } from './api';
import { getToken } from './session';

function auth() {
  return getToken() ?? undefined;
}

/**
 * Money exists here at the moment a slip is verified (ADR-007) and nowhere
 * else. Nothing on the report screens is typed, and there is no endpoint that
 * would let a figure be adjusted — a wrong number is fixed by fixing the bill.
 */
export interface MonthIncome {
  month: string;
  slip_count: number;
  total: number;
  rent: number;
  utility: number;
  other: number;
  late_fee: number;
  cash: number;
  transfer: number;
  qr: number;
}

export function fetchIncome(months = 6) {
  return apiFetch<{ months: MonthIncome[] }>(`/reports/income?months=${months}`, { token: auth() });
}

export interface IncomeDetail {
  month: string;
  total: number;
  payments: {
    id: string;
    amount: number;
    payment_method: 'cash' | 'transfer' | 'qr';
    verified_at: string;
    invoice_number: string;
    billing_period: string;
    room_charge: number;
    utility_charge: number;
    late_fee: number;
    room_number: string;
    tenant_name: string;
    verified_by_name: string;
    submitted_by_name: string;
  }[];
  by_staff: {
    verified_by_name: string;
    slip_count: number;
    total: number;
    /** §15.4: slips recorded and confirmed by the same person (ADR-007). */
    self_recorded: number;
  }[];
}

export function fetchIncomeDetail(month: string) {
  return apiFetch<IncomeDetail>(`/reports/income/detail?month=${month}`, { token: auth() });
}

export interface ReportSummary {
  month: string;
  income: { total: number; slip_count: number; rent: number; utility: number; other: number; late_fee: number };
  billing: {
    invoice_count: number;
    billed_total: number;
    paid_count: number;
    overdue_count: number;
    unpaid_total: number;
  };
  occupancy: { total_rooms: number; occupied_rooms: number };
}

export function fetchSummary(month: string) {
  return apiFetch<ReportSummary>(`/reports/summary?month=${month}`, { token: auth() });
}

/** S40 — the LINE free tier's monthly spend. Not money, but the channel's only running cost. */
export interface LineUsage {
  usage: {
    used_this_month: number;
    queued: number;
    failed: number;
    skipped: number;
    cap: number;
    configured: boolean;
  };
  tenants: { linked: number; total: number };
}

export function fetchLineUsage() {
  return apiFetch<LineUsage>('/reports/line-usage', { token: auth() });
}
