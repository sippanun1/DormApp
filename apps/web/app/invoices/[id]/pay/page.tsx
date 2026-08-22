'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { Alert, Button, Card, Field, inputClass, readonlyClass } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { baht, thaiDate } from '@/lib/format';
import { fetchInvoice, METHOD_LABEL, submitPayment, uploadSlip, type Invoice, type Payment } from '@/lib/billing';

const METHODS: Payment['payment_method'][] = ['transfer', 'qr', 'cash'];

/**
 * S20 — recording a payment.
 *
 * The amount is not an input. Rule 1 says an invoice settles in full or not at
 * all, so there is no partial-amount field to type into: the screen shows what
 * is owed and sends exactly that back. Express refuses anything else anyway —
 * this screen simply doesn't offer a number the system would reject.
 *
 * The slip is required for transfer and QR and optional for cash (owner
 * decision): cash has nothing to photograph, and its check is the ADR-007
 * separation — the person who records it cannot be the person who confirms it.
 *
 * Submitting freezes the late fee (ADR-009). That is stated on the button's
 * own line, because it is the moment the number stops moving.
 */
export default function PayPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [method, setMethod] = useState<Payment['payment_method']>('transfer');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchInvoice(id)
      .then((r) => setInvoice(r.invoice))
      .catch((e) => setError(errorMessage(e, 'โหลดบิลไม่สำเร็จ')));
  }, [id]);

  const slipRequired = method !== 'cash';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!invoice) return;
    setBusy(true);
    setError(null);
    try {
      // Upload first, so a rejected file is fixed on its own field before any
      // payment row exists (E12) — the amount typed above is never lost.
      let slip: string | undefined;
      if (file) slip = (await uploadSlip(file)).slip_file_url;

      await submitPayment(invoice.id, {
        amount: invoice.amount_due,
        payment_method: method,
        ...(slip ? { slip_file_url: slip } : {}),
      });
      router.push(`/invoices/${invoice.id}`);
    } catch (err) {
      setError(errorMessage(err, 'บันทึกการชำระเงินไม่สำเร็จ'));
      setBusy(false);
    }
  }

  return (
    <AppShell screen="S20" title="บันทึกการชำระเงิน">
      {error && <Alert>{error}</Alert>}

      {invoice && (
        <form onSubmit={submit} className="flex max-w-[640px] flex-col gap-3">
          <Card title={`บิล #${invoice.invoice_number}`} hint={`ห้อง ${invoice.room_number} · ${invoice.tenant_name}`}>
            <div className="flex flex-col gap-1 text-sm">
              <div className="flex justify-between">
                <span className="text-text-muted">ยอดบิล</span>
                <span className="money">{baht(invoice.total_amount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">
                  ค่าปรับล่าช้า {invoice.late_fee_is_frozen ? '(คงที่แล้ว)' : `ถึงวันนี้ ${thaiDate(new Date())}`}
                </span>
                <span className="money">{baht(invoice.late_fee_effective)}</span>
              </div>
              <div className="mt-1 flex justify-between border-t border-border pt-2 text-base font-semibold">
                <span>ต้องชำระ</span>
                <span className="money">{baht(invoice.amount_due)}</span>
              </div>
            </div>
          </Card>

          <Card title="รายละเอียดการชำระ">
            <Field label="ยอดที่รับชำระ" hint="ชำระเต็มจำนวนเท่านั้น — ระบบไม่รับชำระบางส่วน">
              {/* Read-only on purpose: rule 1 has no partial-amount input. */}
              <output className={`${readonlyClass} money block text-base`}>{baht(invoice.amount_due)}</output>
            </Field>

            <div className="mt-3 flex flex-col gap-2">
              <span className="text-text-muted">วิธีชำระเงิน</span>
              <div className="flex gap-2">
                {METHODS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMethod(m)}
                    className={`rounded-btn border px-4 py-2 ${
                      method === m ? 'border-primary bg-primary-soft text-primary' : 'border-border'
                    }`}
                  >
                    {METHOD_LABEL[m]}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-3">
              <Field
                label={`สลิป ${slipRequired ? '(จำเป็น)' : '(ไม่จำเป็นสำหรับเงินสด)'}`}
                hint="JPG, PNG หรือ PDF ไม่เกิน 5MB — ระบบตรวจจากไฟล์จริง ไม่ใช่จากนามสกุล"
              >
                <input
                  type="file"
                  accept="image/jpeg,image/png,application/pdf"
                  className={inputClass}
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </Field>
              {method === 'cash' && (
                <p className="mt-2 text-xs text-text-muted">
                  เงินสดไม่มีสลิปให้ตรวจ — ผู้ตรวจสอบคือเจ้าของ ซึ่งไม่ใช่คนรับเงิน
                </p>
              )}
            </div>
          </Card>

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={busy || (slipRequired && !file)}>
              {busy ? 'กำลังบันทึก…' : 'ส่งให้ตรวจสอบ'}
            </Button>
            <span className="text-xs text-text-muted">
              เมื่อส่งแล้ว ค่าปรับจะคงที่ที่ {baht(invoice.late_fee_effective)} และบิลจะรอเจ้าของตรวจสลิป
            </span>
          </div>
        </form>
      )}
    </AppShell>
  );
}
