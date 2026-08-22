'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { Alert, Badge, Card, Loading } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { baht, thaiDate } from '@/lib/format';
import { periodLabel } from '@/lib/period';
import { fetchPendingPayments, METHOD_LABEL, type PendingPayment } from '@/lib/billing';

/**
 * S21 — the verification queue. Admin only, oldest first.
 *
 * The days-waiting badge is the point of the screen: verification is meant to
 * take seconds per slip, and what goes wrong is not a mis-verification but a
 * queue nobody opens for a week. Ordering is the API's, not this page's.
 */
export default function VerifyQueuePage() {
  const [rows, setRows] = useState<PendingPayment[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPendingPayments()
      .then((r) => setRows(r.pending))
      .catch((e) => setError(errorMessage(e, 'โหลดคิวตรวจสอบไม่สำเร็จ')));
  }, []);

  return (
    <AppShell screen="S21" title="รอตรวจสอบ">
      {error && <Alert>{error}</Alert>}
      {!rows && !error && <Loading what="คิว" />}

      {rows && (
        <Card hint={`${rows.length} รายการ`}>
          {rows.length === 0 ? (
            <p className="text-text-muted">ไม่มีสลิปรอตรวจสอบ</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-text-muted">
                <tr>
                  <th className="py-1">รอมาแล้ว</th>
                  <th>บิล</th>
                  <th>ห้อง</th>
                  <th>ผู้เช่า</th>
                  <th>งวด</th>
                  <th>วิธี</th>
                  <th className="text-right">ยอด</th>
                  <th>ส่งโดย</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className="border-t border-border hover:bg-surface">
                    <td className="py-2">
                      <Badge tone={p.days_waiting >= 2 ? 'danger' : p.days_waiting >= 1 ? 'warning' : 'neutral'}>
                        {p.days_waiting === 0 ? 'วันนี้' : `${p.days_waiting} วัน`}
                      </Badge>
                    </td>
                    <td className="money">#{p.invoice_number}</td>
                    <td className="money">{p.room_number}</td>
                    <td>{p.tenant_name}</td>
                    <td>{periodLabel(p.billing_period.slice(0, 10))}</td>
                    <td>
                      {METHOD_LABEL[p.payment_method]}
                      {!p.has_slip && <span className="ml-1 text-xs text-text-muted">(ไม่มีสลิป)</span>}
                    </td>
                    <td className="money text-right">{baht(p.amount)}</td>
                    <td>
                      {p.submitted_by_name}
                      <span className="block text-[11px] text-text-muted">{thaiDate(p.submitted_at)}</span>
                    </td>
                    <td>
                      <Link href={`/verify/${p.id}`} className="text-primary underline">
                        ตรวจสอบ →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </AppShell>
  );
}
