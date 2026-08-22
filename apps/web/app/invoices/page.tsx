'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { Alert, Badge, Card, Loading, type Tone } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { baht, thaiDate } from '@/lib/format';
import { periodLabel } from '@/lib/period';
import { fetchInvoices, INVOICE_STATUS_LABEL, type Invoice, type InvoiceStatus } from '@/lib/billing';

/** One meaning per colour, everywhere: paid=success, waiting=warning, overdue=danger. */
const TONE: Record<InvoiceStatus, Tone> = {
  paid: 'success',
  pending_verification: 'warning',
  unpaid: 'info',
  rejected: 'danger',
};

const FILTERS: { value: '' | InvoiceStatus; label: string }[] = [
  { value: '', label: 'ทั้งหมด' },
  { value: 'unpaid', label: 'ค้างชำระ' },
  { value: 'pending_verification', label: 'รอตรวจสอบ' },
  { value: 'paid', label: 'ชำระแล้ว' },
  { value: 'rejected', label: 'ถูกปฏิเสธ' },
];

/**
 * S18 — the bill list.
 *
 * The late fee column shows the live figure while a bill is unpaid and the
 * frozen one once a payment exists, labelled as which it is (ADR-009). This is
 * the one place on the screen where showing the wrong number actively misleads
 * someone about what they owe.
 */
export default function InvoiceListPage() {
  const [status, setStatus] = useState<'' | InvoiceStatus>('');
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setInvoices(null);
    fetchInvoices(status ? { status } : {})
      .then((r) => setInvoices(r.invoices))
      .catch((e) => setError(errorMessage(e, 'โหลดรายการบิลไม่สำเร็จ')));
  }, [status]);

  return (
    <AppShell screen="S18" title="รายการบิล">
      <Card className="mb-3">
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setStatus(f.value)}
              className={`rounded-btn border px-3 py-1 text-xs ${
                status === f.value ? 'border-primary bg-primary-soft text-primary' : 'border-border'
              }`}
            >
              {f.label}
            </button>
          ))}
          <Link
            href="/invoices/generate"
            className="ml-auto rounded-btn bg-primary px-4 py-2 font-medium text-primary-contrast"
          >
            ออกบิลประจำเดือน
          </Link>
        </div>
      </Card>

      {error && <Alert>{error}</Alert>}
      {!invoices && !error && <Loading what="บิล" />}

      {invoices && (
        <Card hint={`${invoices.length} รายการ`}>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-text-muted">
              <tr>
                <th className="py-1">เลขที่</th>
                <th>ห้อง</th>
                <th>ผู้เช่า</th>
                <th>งวด</th>
                <th>ครบกำหนด</th>
                <th className="text-right">ยอดบิล</th>
                <th className="text-right">ค่าปรับ</th>
                <th className="text-right">ต้องชำระ</th>
                <th>สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id} className="border-t border-border hover:bg-surface">
                  <td className="money py-2">
                    <Link href={`/invoices/${i.id}`} className="text-primary underline">
                      #{i.invoice_number}
                    </Link>
                  </td>
                  <td className="money">{i.room_number}</td>
                  <td>{i.tenant_name}</td>
                  <td>{periodLabel(i.billing_period.slice(0, 10))}</td>
                  <td>{thaiDate(i.due_date)}</td>
                  <td className="money text-right">{baht(i.total_amount)}</td>
                  <td className="money text-right">
                    {i.late_fee_effective > 0 ? (
                      <>
                        <span className={i.late_fee_is_frozen ? '' : 'text-danger'}>
                          {baht(i.late_fee_effective)}
                        </span>
                        <span className="block text-[11px] text-text-muted">
                          {i.late_fee_is_frozen ? 'คงที่แล้ว' : 'กำลังเดิน'}
                        </span>
                      </>
                    ) : (
                      <span className="text-text-muted">—</span>
                    )}
                  </td>
                  <td className="money text-right font-medium">{baht(i.amount_due)}</td>
                  <td>
                    <Badge tone={TONE[i.status]}>{INVOICE_STATUS_LABEL[i.status]}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </AppShell>
  );
}
