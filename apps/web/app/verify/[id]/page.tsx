'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { Alert, Button, Card, inputClass, Loading } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { baht, thaiDate } from '@/lib/format';
import { periodLabel } from '@/lib/period';
import { fetchPayment, METHOD_LABEL, rejectPayment, verifyPayment } from '@/lib/billing';

type Detail = Awaited<ReturnType<typeof fetchPayment>>;

/**
 * S22 + S23 — verifying one slip.
 *
 * The slip image is the screen, not an attachment: verifying *is* looking at
 * it, so it is shown inline rather than linked. The URL is signed and expires
 * — the bucket is private, and a slip carries a name, an amount and a bank
 * account.
 *
 * Rejection needs a reason and cannot be submitted empty (S23). The payment row
 * and its slip are kept: the record of a refused attempt is exactly what
 * matters the first time a tenant says "I did pay".
 */
export default function VerifyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchPayment(id)
      .then(setData)
      .catch((e) => setError(errorMessage(e, 'โหลดรายการไม่สำเร็จ')));
  }, [id]);

  async function act(action: 'verify' | 'reject') {
    setBusy(true);
    setError(null);
    try {
      if (action === 'verify') await verifyPayment(id);
      else await rejectPayment(id, reason.trim());
      router.push('/verify');
    } catch (err) {
      setError(errorMessage(err, 'ดำเนินการไม่สำเร็จ'));
      setBusy(false);
    }
  }

  const p = data?.payment;
  const settled = p ? p.is_verified || p.invoice_status !== 'pending_verification' : false;

  return (
    <AppShell screen="S22" title="ตรวจสอบสลิป">
      {error && <Alert>{error}</Alert>}
      {!data && !error && <Loading what="สลิป" />}

      {data && p && (
        <div className="flex max-w-[1000px] flex-wrap gap-3">
          <Card className="min-w-[380px] flex-1" title="สลิปที่ส่งมา">
            {data.slip_url ? (
              // eslint-disable-next-line @next/next/no-img-element -- signed, expiring URL on a private bucket; not an optimisable static asset
              <img
                src={data.slip_url}
                alt={`สลิปของบิล #${p.invoice_number}`}
                className="max-h-[560px] w-full rounded border border-border object-contain"
              />
            ) : (
              <p className="rounded border border-dashed border-border p-6 text-center text-text-muted">
                {p.payment_method === 'cash'
                  ? 'เงินสด — ไม่มีสลิป ตรวจจากยอดและผู้บันทึกแทน'
                  : 'ไม่พบไฟล์สลิป'}
              </p>
            )}
          </Card>

          <div className="flex min-w-[320px] flex-1 flex-col gap-3">
            <Card title={`บิล #${p.invoice_number}`} hint={`ห้อง ${p.room_number} · ${p.tenant_name}`}>
              <div className="flex flex-col gap-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-text-muted">งวด</span>
                  <span>{periodLabel(p.billing_period.slice(0, 10))}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">ยอดบิล</span>
                  <span className="money">{baht(p.total_amount)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">ค่าปรับ (คงที่ตอนส่งสลิป)</span>
                  <span className="money">{baht(p.late_fee_frozen ?? 0)}</span>
                </div>
                <div className="flex justify-between border-t border-border pt-1 font-semibold">
                  <span>ต้องชำระ</span>
                  <span className="money">{baht(p.amount_due)}</span>
                </div>
                {/* Pre-compared, so the admin is looking at the slip rather
                    than doing arithmetic. The API refused anything unequal. */}
                <div className="flex justify-between">
                  <span className="text-text-muted">ยอดที่ส่ง</span>
                  <span className="money text-success">{baht(p.amount)} · ตรงกัน</span>
                </div>
                <div className="mt-2 flex justify-between text-xs text-text-muted">
                  <span>{METHOD_LABEL[p.payment_method]}</span>
                  <span>
                    ส่งโดย {p.submitted_by_name} · {thaiDate(p.submitted_at)}
                  </span>
                </div>
              </div>
            </Card>

            <Card>
              {settled ? (
                <p className="text-text-muted">
                  รายการนี้ดำเนินการไปแล้ว —{' '}
                  <Link href={`/invoices/${p.invoice_id}`} className="text-primary underline">
                    ดูบิล
                  </Link>
                </p>
              ) : rejecting ? (
                <div className="flex flex-col gap-2">
                  <span className="text-text-muted">เหตุผลที่ปฏิเสธ (จำเป็น)</span>
                  <textarea
                    rows={3}
                    className={inputClass}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="เช่น ยอดในสลิปไม่ตรงกับยอดบิล"
                  />
                  <div className="flex gap-2">
                    <Button variant="danger" type="button" disabled={busy || !reason.trim()} onClick={() => act('reject')}>
                      ยืนยันปฏิเสธ
                    </Button>
                    <Button variant="ghost" type="button" disabled={busy} onClick={() => setRejecting(false)}>
                      ย้อนกลับ
                    </Button>
                  </div>
                  <p className="text-xs text-text-muted">
                    บิลจะกลับเป็นค้างชำระ ค่าปรับเดินต่อ และสลิปนี้ถูกเก็บไว้เป็นหลักฐาน
                  </p>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Button type="button" disabled={busy} onClick={() => act('verify')}>
                    ยืนยันการชำระเงิน
                  </Button>
                  <Button variant="danger" type="button" disabled={busy} onClick={() => setRejecting(true)}>
                    ปฏิเสธสลิป
                  </Button>
                </div>
              )}
            </Card>
          </div>
        </div>
      )}
    </AppShell>
  );
}
