'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { Alert, Badge, Button, Card, Field, inputClass, Loading } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { baht, thaiDate } from '@/lib/format';
import { currentPeriod, periodLabel } from '@/lib/period';
import { fetchCheckout, settleCheckout, type CheckoutPreview } from '@/lib/stays';

/**
 * S27 — สรุปย้ายออก, the move-out settlement.
 *
 * Rule 4 is the whole shape of this screen: the refund floors at zero, and
 * anything above the deposit is shown struck through as waived. There is no
 * "collect the difference" control, no debt field, and nowhere for one to be
 * added later — the database's generated column refuses a negative refund, so
 * the screen is describing a system that cannot do otherwise.
 *
 * Rule 12 supplies the other half: leaving before the agreed term forfeits the
 * deposit, with a reason, and the server refuses a forfeit on a contract that
 * ran its course.
 */
export default function CheckoutPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [data, setData] = useState<CheckoutPreview | null>(null);
  const [electric, setElectric] = useState('');
  const [water, setWater] = useState('');
  const [damage, setDamage] = useState('0');
  const [cleaning, setCleaning] = useState('');
  const [forfeit, setForfeit] = useState(false);
  const [forfeitReason, setForfeitReason] = useState('');
  const [notes, setNotes] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetchCheckout(id)
      .then((r) => {
        setData(r);
        setCleaning(String(r.policy.cleaning_fee ?? 0));
      })
      .catch((e) => setError(errorMessage(e, 'โหลดข้อมูลย้ายออกไม่สำเร็จ')));
  }, [id]);

  useEffect(load, [load]);

  const meter = (type: 'electric' | 'water') => data?.meters.find((m) => m.meter_type === type);

  /**
   * The preview the staff member reads out loud. It is arithmetic only — the
   * figure that gets recorded is the one the server computes from the same
   * inputs, and the two are asserted equal after settling.
   */
  const preview = useMemo(() => {
    if (!data) return null;
    const utilityCost = (['electric', 'water'] as const).reduce((sum, type) => {
      const m = meter(type);
      const value = type === 'electric' ? electric : water;
      if (!m || m.previous_reading === null || value === '') return sum;
      const units = Math.max(0, Number(value) - m.previous_reading);
      return sum + units * m.rate;
    }, 0);

    // The final month's rent + utilities are billed as an ordinary invoice by
    // the settle call, which is why they join `outstanding` rather than being a
    // fourth deduction here.
    const finalBill = utilityCost > 0 ? data.tenancy.monthly_rent + utilityCost : 0;
    const outstanding = data.outstanding_total + finalBill;
    const deductions = Number(cleaning || 0) + Number(damage || 0) + outstanding;
    const deposit = data.tenancy.deposit_amount;

    return {
      utilityCost,
      finalBill,
      outstanding,
      deductions,
      refund: forfeit ? 0 : Math.max(0, deposit - deductions),
      waived: forfeit ? 0 : Math.max(0, deductions - deposit),
    };
  }, [data, electric, water, cleaning, damage, forfeit]);

  async function settle() {
    if (!data) return;
    setBusy(true);
    setError(null);
    try {
      const readings = (['electric', 'water'] as const)
        .map((type) => ({ type, value: type === 'electric' ? electric : water }))
        .filter((r) => r.value !== '')
        .map((r) => ({ meter_type: r.type, new_reading: Number(r.value) }));

      await settleCheckout(id, {
        damage_amount: Number(damage || 0),
        cleaning_fee: Number(cleaning || 0),
        ...(forfeit ? { forfeit_deposit: true, forfeit_reason: forfeitReason.trim() } : {}),
        ...(readings.length ? { final_readings: readings, final_billing_period: currentPeriod() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      setConfirming(false);
      load();
    } catch (e) {
      setError(errorMessage(e, 'บันทึกการย้ายออกไม่สำเร็จ'));
    } finally {
      setBusy(false);
    }
  }

  const done = data?.settlement ?? null;

  return (
    <AppShell screen="S27" title="สรุปย้ายออก">
      {error && <Alert>{error}</Alert>}
      {!data && !error && <Loading what="ข้อมูลสัญญา" />}

      {data && (
        <div className="flex max-w-[900px] flex-col gap-3">
          <Card>
            <div className="flex flex-wrap items-center gap-4">
              <h2 className="money text-xl">ห้อง {data.tenancy.room_number}</h2>
              <span>{data.tenancy.tenant_name}</span>
              <span className="money text-text-muted">{data.tenancy.tenant_phone}</span>
              {/* Rule 12 made visible: staff must see the agreed term here
                  rather than having to remember it. */}
              {data.tenancy.is_early ? (
                <Badge tone="danger">ออกก่อนครบสัญญา — เหลืออีก {data.tenancy.days_remaining} วัน</Badge>
              ) : (
                <Badge tone="success">ครบกำหนดสัญญาแล้ว</Badge>
              )}
              <span className="ml-auto text-xs text-text-muted">
                เริ่ม {thaiDate(data.tenancy.start_date)} · ตกลง {data.tenancy.agreed_months} เดือน (ถึง{' '}
                {thaiDate(data.tenancy.agreed_until)})
              </span>
            </div>
          </Card>

          {done ? (
            <Card title="คิดยอดย้ายออกแล้ว" hint={done.settled_at ? thaiDate(done.settled_at) : undefined}>
              <SettlementLines s={done} />
              <p className="mt-3 text-xs text-text-muted">
                รายการนี้บันทึกแล้วและแก้ไขไม่ได้ — เป็นบันทึกของเงินที่ส่งมอบกันจริง
              </p>
              <Link href="/rooms" className="mt-3 inline-block text-primary underline">
                ← กลับไปผังห้อง
              </Link>
            </Card>
          ) : (
            <>
              <Card title="จดมิเตอร์ครั้งสุดท้าย" hint="ไม่กรอกก็ได้ ถ้าจดและออกบิลเดือนสุดท้ายไปแล้ว">
                <div className="grid grid-cols-2 gap-4">
                  {(['electric', 'water'] as const).map((type) => {
                    const m = meter(type);
                    const value = type === 'electric' ? electric : water;
                    const units =
                      m && m.previous_reading !== null && value !== ''
                        ? Math.max(0, Number(value) - m.previous_reading)
                        : 0;
                    return (
                      <Field
                        key={type}
                        label={`${type === 'electric' ? '⚡ ไฟฟ้า' : '💧 น้ำ'} — เลขครั้งสุดท้าย`}
                        hint={
                          m?.previous_reading === null
                            ? 'ยังไม่มีเลขครั้งก่อนของสัญญานี้'
                            : `ครั้งก่อน ${m?.previous_reading} · ${units} หน่วย × ${baht(m?.rate ?? 0)} = ${baht(units * (m?.rate ?? 0))}`
                        }
                      >
                        <input
                          type="number"
                          className={`${inputClass} money`}
                          value={value}
                          onChange={(e) => (type === 'electric' ? setElectric(e.target.value) : setWater(e.target.value))}
                        />
                      </Field>
                    );
                  })}
                </div>
                <p className="mt-2 text-xs text-text-muted">
                  เลขครั้งก่อนมาจากที่บันทึกไว้เดือนก่อน และเซิร์ฟเวอร์เป็นผู้กำหนด — พิมพ์ทับไม่ได้
                </p>
              </Card>

              {(data.outstanding.length > 0 || (preview?.finalBill ?? 0) > 0) && (
                <Card title="ยอดค้างชำระ" hint="รวมอยู่ในรายการหักจากเงินประกัน">
                  <ul className="flex flex-col gap-1 text-sm">
                    {data.outstanding.map((i) => (
                      <li key={i.id} className="flex justify-between border-b border-border py-1 last:border-0">
                        <span>
                          บิล #{i.invoice_number} · งวด {periodLabel(i.billing_period.slice(0, 10))}
                        </span>
                        <span className="money">{baht(i.amount_due)}</span>
                      </li>
                    ))}
                    {(preview?.finalBill ?? 0) > 0 && (
                      <li className="flex justify-between py-1">
                        <span>
                          บิลเดือนสุดท้าย (ค่าเช่า {baht(data.tenancy.monthly_rent)} + ค่าน้ำ-ไฟ{' '}
                          {baht(preview?.utilityCost ?? 0)}) — จะออกบิลเมื่อยืนยัน
                        </span>
                        <span className="money">{baht(preview?.finalBill ?? 0)}</span>
                      </li>
                    )}
                  </ul>
                </Card>
              )}

              <Card title="สรุปเงินประกัน">
                <div className="grid grid-cols-2 gap-4">
                  <Field label="ค่าทำความสะอาด" hint="ค่าตั้งต้นจากการตั้งค่าระบบ เพิ่มได้ถ้าสกปรกมาก">
                    <input
                      type="number"
                      min={0}
                      className={`${inputClass} money`}
                      value={cleaning}
                      onChange={(e) => setCleaning(e.target.value)}
                    />
                  </Field>
                  <Field label="ค่าเสียหาย (ถ้ามี)">
                    <input
                      type="number"
                      min={0}
                      className={`${inputClass} money`}
                      value={damage}
                      onChange={(e) => setDamage(e.target.value)}
                    />
                  </Field>
                </div>

                {data.tenancy.is_early && (
                  <div className="mt-3 rounded border border-danger bg-[var(--danger-soft)] p-3">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={forfeit} onChange={(e) => setForfeit(e.target.checked)} />
                      <span>ริบเงินประกัน (ย้ายออกก่อนครบสัญญา)</span>
                    </label>
                    {forfeit && (
                      <input
                        className={`${inputClass} mt-2 w-full`}
                        placeholder="เหตุผล (จำเป็น)"
                        value={forfeitReason}
                        onChange={(e) => setForfeitReason(e.target.value)}
                      />
                    )}
                  </div>
                )}

                {preview && (
                  <div className="mt-4 flex max-w-[420px] flex-col gap-1 text-sm">
                    <Line label="เงินประกัน" value={baht(data.tenancy.deposit_amount)} />
                    <Line label="หัก ค่าทำความสะอาด" value={`-${baht(Number(cleaning || 0))}`} />
                    <Line label="หัก ค่าเสียหาย" value={`-${baht(Number(damage || 0))}`} />
                    <Line label="หัก ยอดค้างชำระ" value={`-${baht(preview.outstanding)}`} />
                    {forfeit && (
                      <Line label="ริบเงินประกัน (ออกก่อนครบสัญญา)" value={`-${baht(data.tenancy.deposit_amount)}`} />
                    )}
                    {preview.waived > 0 && (
                      // Rule 4: struck through, and there is no control to collect it.
                      <div className="flex justify-between text-text-muted line-through">
                        <span>ส่วนเกิน (ไม่เรียกเก็บ)</span>
                        <span className="money">{baht(preview.waived)}</span>
                      </div>
                    )}
                    <div className="mt-1 flex justify-between border-t border-border pt-2 text-base font-semibold">
                      <span>คืนเงินประกัน</span>
                      <span className="money">{baht(preview.refund)}</span>
                    </div>
                    <p className="text-xs text-text-muted">
                      คืนไม่เกินยอดเงินประกันที่วางไว้เสมอ — ไม่มีการเรียกเก็บส่วนเกินจากผู้เช่าที่ย้ายออกไปแล้ว
                    </p>
                  </div>
                )}

                <Field label="หมายเหตุ">
                  <textarea rows={2} className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
                </Field>
              </Card>

              <Card>
                {confirming ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-sm">
                      ปิดสัญญาห้อง {data.tenancy.room_number} และคืนเงินประกัน {baht(preview?.refund ?? 0)}?
                    </span>
                    <Button type="button" disabled={busy || (forfeit && !forfeitReason.trim())} onClick={settle}>
                      {busy ? 'กำลังบันทึก…' : 'ยืนยันย้ายออก'}
                    </Button>
                    <Button variant="ghost" type="button" disabled={busy} onClick={() => setConfirming(false)}>
                      ยกเลิก
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-3">
                    <Button type="button" onClick={() => setConfirming(true)}>
                      คิดยอดและปิดสัญญา
                    </Button>
                    <span className="text-xs text-text-muted">
                      จะออกบิลเดือนสุดท้าย (ถ้ากรอกมิเตอร์), ปิดสัญญา และบันทึกยอดคืนในรายการเดียว
                    </span>
                  </div>
                )}
              </Card>
            </>
          )}
        </div>
      )}
    </AppShell>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-border py-1 last:border-0">
      <span className="text-text-muted">{label}</span>
      <span className="money">{value}</span>
    </div>
  );
}

function SettlementLines({ s }: { s: NonNullable<CheckoutPreview['settlement']> }) {
  return (
    <div className="flex max-w-[420px] flex-col gap-1 text-sm">
      <Line label="เงินประกัน" value={baht(s.deposit_amount)} />
      <Line label="หัก ค่าทำความสะอาด" value={`-${baht(s.cleaning_fee)}`} />
      <Line label="หัก ค่าเสียหาย" value={`-${baht(s.damage_amount)}`} />
      <Line label="หัก ยอดค้างชำระ" value={`-${baht(s.outstanding_amount)}`} />
      {s.deposit_forfeited && <Line label={`ริบเงินประกัน — ${s.forfeit_reason ?? ''}`} value={`-${baht(s.deposit_amount)}`} />}
      {s.excess_waived > 0 && (
        <div className="flex justify-between text-text-muted line-through">
          <span>ส่วนเกิน (ไม่เรียกเก็บ)</span>
          <span className="money">{baht(s.excess_waived)}</span>
        </div>
      )}
      <div className="mt-1 flex justify-between border-t border-border pt-2 text-base font-semibold">
        <span>คืนเงินประกัน</span>
        <span className="money">{baht(s.refund_amount)}</span>
      </div>
    </div>
  );
}
