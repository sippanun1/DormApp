'use client';

import { useEffect, useState } from 'react';
import { TenantShell } from '@/components/TenantShell';
import { Alert, Badge, Card, Loading } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import type { Invoice, InvoiceTransfer, UtilityLine } from '@/lib/billing';
import { baht, thaiDate } from '@/lib/format';
import { fetchTenantInvoice } from '@/lib/tenant';

/**
 * S34 — one bill, with the meter readings behind it.
 *
 * The utility figures are shown as old → new × rate, not as a lump sum: rule 7
 * makes the working tenant-visible, and it is what lets a tenant check the
 * number against the dial on their own wall. `ประมาณการ` is flagged for the
 * same reason (rule 9).
 */
const METER_LABEL: Record<string, string> = { electric: 'ค่าไฟ', water: 'ค่าน้ำ' };

const STATUS: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'info' }> = {
  paid: { label: 'ชำระแล้ว', tone: 'success' },
  pending_verification: { label: 'รอตรวจสอบ', tone: 'warning' },
  unpaid: { label: 'ค้างชำระ', tone: 'danger' },
  rejected: { label: 'ต้องส่งสลิปใหม่', tone: 'danger' },
};

export default function TenantBillPage({ params }: { params: { id: string } }) {
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [lines, setLines] = useState<UtilityLine[]>([]);
  const [transfers, setTransfers] = useState<InvoiceTransfer[]>([]);
  const [error, setError] = useState<string | null>(null);

  /** A transfer month — the only time this bill names a room per line. */
  const multiRoom = new Set(lines.map((l) => l.room_number)).size > 1;

  useEffect(() => {
    fetchTenantInvoice(params.id)
      .then((r) => {
        setInvoice(r.invoice);
        setLines(r.utility_lines);
        setTransfers(r.transfers);
      })
      .catch((e) => setError(errorMessage(e, 'โหลดบิลไม่สำเร็จ')));
  }, [params.id]);

  return (
    <TenantShell title={invoice ? `บิล #${invoice.invoice_number}` : 'บิล'} back="/t">
      {error && <Alert>{error}</Alert>}
      {!invoice && !error && <Loading what="บิล" />}

      {invoice && (
        <>
          <Card className="mb-3" hint={`ครบกำหนด ${thaiDate(invoice.due_date)}`}>
            <div className="mb-3">
              <Badge tone={STATUS[invoice.status]?.tone ?? 'info'}>
                {STATUS[invoice.status]?.label ?? invoice.status}
              </Badge>
            </div>
            <dl className="flex flex-col gap-1 text-sm">
              <Row label="ค่าเช่าห้อง" value={baht(invoice.room_charge)} />
              <Row label="ค่าน้ำ-ค่าไฟ" value={baht(invoice.utility_charge)} />
              {invoice.other_charges > 0 && <Row label="ค่าใช้จ่ายอื่น" value={baht(invoice.other_charges)} />}
              {invoice.late_fee_effective > 0 && (
                <Row label="ค่าปรับล่าช้า" value={baht(invoice.late_fee_effective)} />
              )}
              <div className="mt-1 flex justify-between border-t border-border pt-2 text-base font-semibold">
                <span>รวมทั้งสิ้น</span>
                <span className="money">{baht(invoice.amount_due)}</span>
              </div>
            </dl>

            {/* ADR-009, said plainly: an unpaid bill's fee is still moving. */}
            {invoice.late_fee_effective > 0 && (
              <p className="mt-3 text-xs text-text-muted">
                {invoice.late_fee_is_frozen
                  ? 'ค่าปรับถูกล็อกไว้แล้วตั้งแต่วันที่ส่งสลิป — จะไม่เพิ่มขึ้นอีก'
                  : 'ค่าปรับเพิ่มขึ้นทุกวันจนกว่าจะชำระ'}
              </p>
            )}
          </Card>

          {lines.length > 0 && (
            <Card title="ที่มาของค่าน้ำ-ค่าไฟ" hint="เทียบกับมิเตอร์หน้าห้องได้">
              <ul className="flex flex-col gap-3">
                {lines.map((l) => (
                  <li key={`${l.room_number}-${l.meter_type}`} className="text-sm">
                    <div className="flex justify-between font-medium">
                      <span>
                        {/* Rule 10.3: in the month a tenant moved, this list has
                            two of each meter. Rule 7 makes the bill checkable
                            against the meter on the wall — which is only true
                            if it says which wall. */}
                        {multiRoom && <span className="text-text-muted">ห้อง {l.room_number} · </span>}
                        {METER_LABEL[l.meter_type] ?? l.meter_type}
                        {l.is_estimated && (
                          <span className="ml-2">
                            <Badge tone="warning">ประมาณการ</Badge>
                          </span>
                        )}
                      </span>
                      <span className="money">{baht(l.computed_cost)}</span>
                    </div>
                    <div className="mt-1 font-mono text-xs text-text-muted">
                      {l.old_reading} → {l.new_reading} = {l.new_reading - l.old_reading} หน่วย × {baht(l.rate)}
                    </div>
                  </li>
                ))}
              </ul>
              {transfers.map((t) => (
                <p key={t.transferred_on} className="mt-3 text-xs text-text-muted">
                  ย้ายจากห้อง {t.from_room} ไปห้อง {t.to_room} เมื่อ {thaiDate(t.transferred_on)} — เดือนนี้จึงมีค่าน้ำค่าไฟ
                  สองช่วง ส่วนค่าเช่าคิดครั้งเดียวเท่าเดิม
                </p>
              ))}
            </Card>
          )}

          {/* Rule 1, where the tenant would otherwise look for a "pay part of it"
              button. Payment itself is staff-side (slip upload, S19) — nothing
              on a tenant token moves money. */}
          <p className="mt-4 text-center text-xs text-text-muted">
            ชำระเต็มจำนวนเท่านั้น — ระบบไม่รับชำระบางส่วน · ส่งสลิปที่สำนักงาน
          </p>
        </>
      )}
    </TenantShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-text-muted">{label}</dt>
      <dd className="money">{value}</dd>
    </div>
  );
}
