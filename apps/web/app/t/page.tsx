'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { TenantShell } from '@/components/TenantShell';
import { Alert, Badge, Card, Loading } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import type { Invoice } from '@/lib/billing';
import { baht, thaiDate } from '@/lib/format';
import { fetchTenantInvoices, fetchTenantMe, type TenantMe } from '@/lib/tenant';

/** S33 — the tenant's home: their room, their contract, what they owe. */
const STATUS: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'info' }> = {
  paid: { label: 'ชำระแล้ว', tone: 'success' },
  pending_verification: { label: 'รอตรวจสอบ', tone: 'warning' },
  unpaid: { label: 'ค้างชำระ', tone: 'danger' },
  rejected: { label: 'ต้องส่งสลิปใหม่', tone: 'danger' },
};

export default function TenantHomePage() {
  const [me, setMe] = useState<TenantMe | null>(null);
  const [unread, setUnread] = useState(0);
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchTenantMe(), fetchTenantInvoices()])
      .then(([m, inv]) => {
        setMe(m.me);
        setUnread(m.unread_count);
        setInvoices(inv.invoices);
      })
      .catch((e) => setError(errorMessage(e, 'โหลดข้อมูลไม่สำเร็จ')));
  }, []);

  // The bill that needs attention is the newest unsettled one; everything older
  // is history. Chosen here rather than in the API because it is presentation —
  // the list itself is already ordered by the server.
  const current = invoices?.find((i) => i.status !== 'paid') ?? invoices?.[0] ?? null;
  const past = invoices?.filter((i) => i.id !== current?.id) ?? [];

  return (
    <TenantShell title={me ? `สวัสดี, ${me.full_name}` : 'หน้าหลัก'}>
      {error && <Alert>{error}</Alert>}
      {!me && !error && <Loading what="ข้อมูลห้อง" />}

      {me && (
        <>
          {unread > 0 && (
            <Link href="/t/notifications" className="mb-3 block">
              <Card>
                <span className="text-sm font-medium text-primary">
                  มีการแจ้งเตือนใหม่ {unread} รายการ →
                </span>
              </Card>
            </Link>
          )}

          <Card className="mb-3" title={me.room_number ? `ห้อง ${me.room_number}` : 'ยังไม่มีห้อง'}>
            {me.tenancy_id ? (
              <dl className="flex flex-col gap-1 text-sm">
                <Row label="ประเภทห้อง" value={me.room_type_name ?? '—'} />
                <Row label="ค่าเช่า/เดือน" value={baht(me.monthly_rent)} />
                <Row label="เงินประกันที่วางไว้" value={baht(me.deposit_amount)} />
                <Row
                  label="สัญญา"
                  value={`${thaiDate(me.start_date!)}${me.end_date ? ` → ${thaiDate(me.end_date)}` : ''}`}
                />
                {me.agreed_months && <Row label="ตกลงอยู่" value={`${me.agreed_months} เดือน`} />}
              </dl>
            ) : (
              // Not a 404: the notifications below are still theirs to read.
              <p className="text-sm text-text-muted">ไม่มีสัญญาที่ใช้งานอยู่</p>
            )}
          </Card>

          {current && (
            <Card
              className="mb-3"
              title={`บิลล่าสุด #${current.invoice_number}`}
              hint={`ครบกำหนด ${thaiDate(current.due_date)}`}
            >
              <div className="mb-2">
                <Badge tone={STATUS[current.status]?.tone ?? 'info'}>
                  {STATUS[current.status]?.label ?? current.status}
                </Badge>
              </div>
              <dl className="flex flex-col gap-1 text-sm">
                <Row label="ค่าเช่าห้อง" value={baht(current.room_charge)} />
                <Row label="ค่าน้ำ-ค่าไฟ" value={baht(current.utility_charge)} />
                {current.late_fee_effective > 0 && (
                  <Row
                    label={current.late_fee_is_frozen ? 'ค่าปรับล่าช้า' : 'ค่าปรับล่าช้า (เพิ่มขึ้นทุกวัน)'}
                    value={baht(current.late_fee_effective)}
                  />
                )}
                <div className="mt-1 flex justify-between border-t border-border pt-2 text-base font-semibold">
                  <span>รวมทั้งสิ้น</span>
                  <span className="money">{baht(current.amount_due)}</span>
                </div>
              </dl>
              <Link
                href={`/t/bill/${current.id}`}
                className="mt-3 flex min-h-[52px] items-center justify-center rounded-btn bg-primary text-base font-medium text-white"
              >
                ดูรายละเอียดบิล
              </Link>
            </Card>
          )}

          {past.length > 0 && (
            <Card title="บิลย้อนหลัง">
              <ul className="flex flex-col">
                {past.map((i) => (
                  <li key={i.id}>
                    <Link href={`/t/bill/${i.id}`} className="flex min-h-[44px] items-center justify-between py-2 text-sm">
                      <span>#{i.invoice_number}</span>
                      <span className="flex items-center gap-2">
                        <span className="money">{baht(i.amount_due)}</span>
                        <Badge tone={STATUS[i.status]?.tone ?? 'info'}>{STATUS[i.status]?.label ?? i.status}</Badge>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
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
