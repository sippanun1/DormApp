'use client';

import { apiFetch, apiUpload } from './api';
import { getToken } from './session';

/** Every call carries the shift's token; Express decides what it may do. */
function auth() {
  return getToken() ?? undefined;
}

function send<T>(path: string, method: 'POST' | 'PATCH', body?: unknown) {
  return apiFetch<T>(path, { method, token: auth(), ...(body ? { body: JSON.stringify(body) } : {}) });
}

export type InvoiceStatus = 'unpaid' | 'pending_verification' | 'paid' | 'rejected';

export interface Invoice {
  id: string;
  invoice_number: string;
  tenancy_id: string;
  billing_period: string;
  room_charge: number;
  utility_charge: number;
  other_charges: number;
  total_amount: number;
  due_date: string;
  status: InvoiceStatus;
  /** ADR-009: null until a payment is submitted, then fixed for good. */
  late_fee_frozen: number | null;
  late_fee_live: number;
  late_fee_effective: number;
  late_fee_is_frozen: boolean;
  amount_due: number;
  room_number: string;
  tenant_name: string;
  tenant_phone: string | null;
}

export interface UtilityLine {
  meter_type: 'electric' | 'water';
  old_reading: number;
  new_reading: number;
  rate: number;
  computed_cost: number;
  is_estimated: boolean;
  /**
   * Which room this line is for. One room in an ordinary month; in a transfer
   * month there are two of every meter (rule 13, Rule 10.3) and without this
   * the bill shows two ค่าไฟฟ้า rows with no way to tell them apart.
   */
  room_number: string;
}

/** The move behind a transfer month's two utility blocks. Empty in every other month. */
export interface InvoiceTransfer {
  transferred_on: string;
  from_room: string;
  to_room: string;
}

export interface StatusHistoryRow {
  old_status: string;
  new_status: string;
  reason: string | null;
  changed_at: string;
}

export interface Payment {
  id: string;
  invoice_id: string;
  amount: number;
  payment_method: 'cash' | 'transfer' | 'qr';
  slip_file_url: string | null;
  submitted_at: string;
  submitted_by_name: string;
  verified_at: string | null;
  verified_by_name: string | null;
  is_verified: boolean;
}

export interface PendingPayment extends Payment {
  days_waiting: number;
  has_slip: boolean;
  invoice_number: string;
  billing_period: string;
  total_amount: number;
  late_fee_frozen: number | null;
  room_number: string;
  tenant_name: string;
}

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  unpaid: 'ค้างชำระ',
  pending_verification: 'รอตรวจสอบ',
  paid: 'ชำระแล้ว',
  rejected: 'ถูกปฏิเสธ',
};

export const METHOD_LABEL: Record<Payment['payment_method'], string> = {
  cash: 'เงินสด',
  transfer: 'โอนเงิน',
  qr: 'QR พร้อมเพย์',
};

export function fetchInvoices(params: { status?: string; tenancy_id?: string } = {}) {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]);
  return apiFetch<{ invoices: Invoice[] }>(`/invoices${q.size ? `?${q}` : ''}`, { token: auth() });
}

export function fetchInvoice(id: string) {
  return apiFetch<{
    invoice: Invoice;
    utility_lines: UtilityLine[];
    status_history: StatusHistoryRow[];
    transfers: InvoiceTransfer[];
  }>(
    `/invoices/${id}`,
    { token: auth() },
  );
}

export function fetchInvoicePayments(id: string) {
  return apiFetch<{ payments: Payment[] }>(`/invoices/${id}/payments`, { token: auth() });
}

export interface ReadyRow {
  tenancy_id: string;
  room_number: string;
  tenant_name: string;
  monthly_rent: number;
  utility_charge: number;
  total_amount: number;
}

export function fetchReady(period: string) {
  return apiFetch<{ ready: ReadyRow[]; count: number }>(`/invoices/ready?billing_period=${period}`, {
    token: auth(),
  });
}

export function generateInvoice(tenancyId: string, billing_period: string) {
  return send<{ invoice: { id: string; invoice_number: string } }>(`/tenancies/${tenancyId}/invoices`, 'POST', {
    billing_period,
  });
}

export function generateBatch(billing_period: string) {
  return send<{
    generated_count: number;
    generated: { room_number: string; invoice_number: string }[];
    skipped: { room_number: string; reason: string }[];
  }>('/invoices/batch', 'POST', { billing_period });
}

/**
 * Rule 1: the amount is never typed. The screen sends back exactly the
 * `amount_due` the API quoted, and Express refuses anything else — a partial
 * payment and an overpayment are equally a disagreement with the receipt.
 */
export function submitPayment(invoiceId: string, body: {
  amount: number;
  payment_method: Payment['payment_method'];
  slip_file_url?: string;
}) {
  return send<{ payment: Payment }>(`/invoices/${invoiceId}/payments`, 'POST', body);
}

export function uploadSlip(file: File) {
  const form = new FormData();
  form.append('slip', file);
  return apiUpload<{ slip_file_url: string; mime_type: string }>('/payments/slips', form, auth());
}

export function fetchPendingPayments() {
  return apiFetch<{ pending: PendingPayment[]; count: number }>('/payments/pending', { token: auth() });
}

export function fetchPayment(id: string) {
  return apiFetch<{
    payment: Payment & {
      invoice_number: string;
      invoice_status: InvoiceStatus;
      billing_period: string;
      total_amount: number;
      late_fee_frozen: number | null;
      amount_due: number;
      room_number: string;
      tenant_name: string;
      tenant_phone: string | null;
    };
    /** Short-lived and signed — the bucket is private, so this expires. */
    slip_url: string | null;
  }>(`/payments/${id}`, { token: auth() });
}

export function verifyPayment(id: string) {
  return send<{ payment: { id: string } }>(`/payments/${id}/verify`, 'POST', {});
}

export function rejectPayment(id: string, reason: string) {
  return send<{ payment: { id: string } }>(`/payments/${id}/reject`, 'POST', { reason });
}
