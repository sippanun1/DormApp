'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { Alert, Badge, Card, Loading, type Tone } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { baht, thaiDate } from '@/lib/format';
import { periodLabel } from '@/lib/period';
import {
  fetchInvoice,
  fetchInvoicePayments,
  INVOICE_STATUS_LABEL,
  METHOD_LABEL,
  type Invoice,
  type InvoiceStatus,
  type Payment,
  type StatusHistoryRow,
  type InvoiceTransfer,
  type UtilityLine,
} from '@/lib/billing';

const TONE: Record<InvoiceStatus, Tone> = {
  paid: 'success',
  pending_verification: 'warning',
  unpaid: 'info',
  rejected: 'danger',
};

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex justify-between border-b border-border py-[6px] last:border-0">
      <span className={muted ? 'text-text-muted' : ''}>{label}</span>
      <span className={`money ${muted ? 'text-text-muted' : ''}`}>{value}</span>
    </div>
  );
}

/**
 * S19 — one bill.
 *
 * Two things this screen exists to make unambiguous:
 *   The late fee is labelled live or frozen, never shown as a bare number
 *   (ADR-009). A tenant reading "฿250" has to know whether it will be ฿300
 *   tomorrow.
 *   The utility charge is broken back down into its meter readings. The
 *   database stores one summed figure; the API derives the split so nobody is
 *   asked to accept an opaque total (rule 7).
 */
export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [lines, setLines] = useState<UtilityLine[]>([]);
  const [transfers, setTransfers] = useState<InvoiceTransfer[]>([]);
  const [history, setHistory] = useState<StatusHistoryRow[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [error, setError] = useState<string | null>(null);

  /** A transfer month, and the only time a bill names the room on each line. */
  const multiRoom = new Set(lines.map((l) => l.room_number)).size > 1;

  useEffect(() => {
    fetchInvoice(id)
      .then((r) => {
        setInvoice(r.invoice);
        setLines(r.utility_lines);
        setTransfers(r.transfers);
        setHistory(r.status_history);
      })
      .catch((e) => setError(errorMessage(e, 'โหลดบิลไม่สำเร็จ')));
    fetchInvoicePayments(id)
      .then((r) => setPayments(r.payments))
      .catch(() => undefined);
  }, [id]);

  return (
    <AppShell screen="S19" title="รายละเอียดบิล">
      {error && <Alert>{error}</Alert>}
      {!invoice && !error && <Loading what="บิล" />}

      {invoice && (
        <div className="flex max-w-[900px] flex-col gap-3">
          <Card>
            <div className="flex flex-wrap items-center gap-4">
              <div>
                <h2 className="money text-xl">#{invoice.invoice_number}</h2>
                <p className="text-xs text-text-muted">
                  ห้อง {invoice.room_number} · {invoice.tenant_name} · งวด{' '}
                  {periodLabel(invoice.billing_period.slice(0, 10))}
                </p>
              </div>
              <Badge tone={TONE[invoice.status]}>{INVOICE_STATUS_LABEL[invoice.status]}</Badge>
              <span className="text-xs text-text-muted">ครบกำหนด {thaiDate(invoice.due_date)}</span>

              {(invoice.status === 'unpaid' || invoice.status === 'rejected') && (
                <Link
                  href={`/invoices/${invoice.id}/pay`}
                  className="ml-auto rounded-btn bg-primary px-4 py-2 font-medium text-primary-contrast"
                >
                  บันทึกการชำระเงิน
                </Link>
              )}
            </div>
          </Card>

          <Card title="รายการเรียกเก็บ">
            {/* Rule 2 — the rent on a bill is the contract's rent, frozen at
                signing, never the room's current standard price. */}
            <Row label="ค่าเช่าห้อง" value={baht(invoice.room_charge)} />
            {/* Rule 10.3: a transfer month bills two utility periods against
                one room charge. The room is named on every line only when there
                is more than one — labelling ห้อง on an ordinary bill would be
                noise, and leaving it off a transfer bill makes two identical
                ค่าไฟฟ้า rows. The key is room+meter for the same reason: in a
                transfer month meter_type alone is not unique. */}
            {lines.map((l) => (
              <Row
                key={`${l.room_number}-${l.meter_type}`}
                label={`${multiRoom ? `ห้อง ${l.room_number} · ` : ''}ค่า${
                  l.meter_type === 'electric' ? 'ไฟฟ้า' : 'น้ำ'
                } ${l.new_reading - l.old_reading} หน่วย × ${baht(l.rate)}${
                  l.is_estimated ? ' (ประมาณการ)' : ''
                }`}
                value={baht(l.computed_cost)}
              />
            ))}
            {transfers.map((t) => (
              <p key={t.transferred_on} className="mt-1 text-xs text-text-muted">
                ย้ายจากห้อง {t.from_room} ไปห้อง {t.to_room} เมื่อ {thaiDate(t.transferred_on)} — ค่าน้ำค่าไฟคิดสองช่วง
                ค่าเช่าคิดครั้งเดียวเท่าเดิม
              </p>
            ))}
            {invoice.other_charges !== 0 && <Row label="รายการอื่น" value={baht(invoice.other_charges)} />}
            <Row label="ยอดบิล" value={baht(invoice.total_amount)} />

            <div className="mt-2 flex justify-between border-t border-border pt-2">
              <span>
                ค่าปรับล่าช้า{' '}
                <span className={`text-xs ${invoice.late_fee_is_frozen ? 'text-text-muted' : 'text-danger'}`}>
                  {invoice.late_fee_is_frozen
                    ? 'คงที่ตั้งแต่ส่งสลิป — ไม่เพิ่มอีก'
                    : 'คำนวณสด ฿50/วัน ตั้งแต่วันที่ 6'}
                </span>
              </span>
              <span className="money">{baht(invoice.late_fee_effective)}</span>
            </div>

            <div className="mt-2 flex justify-between border-t border-border pt-2 text-base font-semibold">
              <span>ต้องชำระ</span>
              <span className="money">{baht(invoice.amount_due)}</span>
            </div>

            {/* Rule 1, said plainly on the screen that shows the number. */}
            <p className="mt-2 text-xs text-text-muted">ชำระเต็มจำนวนเท่านั้น — ระบบไม่รับชำระบางส่วน</p>
          </Card>

          {payments.length > 0 && (
            <Card title="การชำระเงิน" hint="รวมรายการที่ถูกปฏิเสธ — เก็บไว้เป็นหลักฐานเสมอ">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-text-muted">
                  <tr>
                    <th className="py-1">วันที่ส่ง</th>
                    <th>วิธี</th>
                    <th className="text-right">ยอด</th>
                    <th>บันทึกโดย</th>
                    <th>ตรวจสอบ</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id} className="border-t border-border">
                      <td className="py-2">{thaiDate(p.submitted_at)}</td>
                      <td>{METHOD_LABEL[p.payment_method]}</td>
                      <td className="money text-right">{baht(p.amount)}</td>
                      <td>{p.submitted_by_name}</td>
                      <td>
                        {p.is_verified ? (
                          <Badge tone="success">ตรวจแล้ว · {p.verified_by_name}</Badge>
                        ) : (
                          <Badge tone="warning">รอตรวจสอบ</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          {history.length > 0 && (
            <Card title="ประวัติสถานะ" hint="บันทึกแบบเพิ่มอย่างเดียว — ลบหรือแก้ไม่ได้">
              <ul className="flex flex-col gap-1 text-sm">
                {history.map((h, idx) => (
                  <li key={idx} className="flex gap-3 border-b border-border py-1 last:border-0">
                    <span className="text-text-muted">{thaiDate(h.changed_at)}</span>
                    <span>
                      {INVOICE_STATUS_LABEL[h.old_status as InvoiceStatus] ?? h.old_status} →{' '}
                      {INVOICE_STATUS_LABEL[h.new_status as InvoiceStatus] ?? h.new_status}
                    </span>
                    {h.reason && <span className="text-danger">เหตุผล: {h.reason}</span>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}
    </AppShell>
  );
}
