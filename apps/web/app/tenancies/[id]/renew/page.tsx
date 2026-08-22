'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { Alert, Badge, Button, Card, Field, inputClass, Loading, readonlyClass } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { baht, thaiDate } from '@/lib/format';
import { fetchRenewal, renewTenancy, type RenewalPreview } from '@/lib/stays';

/**
 * S35 — ต่อสัญญา.
 *
 * Rule 4.8, stated on the screen because it is counter-intuitive: renewing is
 * signing a NEW contract, not extending the old one. The old contract closes on
 * its agreed end date with its own rent and term intact, and the new one starts
 * the next day. That is what makes a renewal readable a year later — the two
 * rows are linked, and neither one was edited after signing.
 *
 * เงินประกัน is carried, not collected again (rule 5): the tenant hands over
 * nothing at a renewal.
 *
 * The new rent defaults to the OLD contract's rent, not the room's current
 * standard price. Both are shown, because a renewal is exactly the moment those
 * two are allowed to diverge — and a raise that nobody discussed must not
 * happen just because a standard price moved.
 */
export default function RenewPage() {
  const { id } = useParams<{ id: string }>();

  const [data, setData] = useState<RenewalPreview | null>(null);
  const [months, setMonths] = useState('12');
  const [rent, setRent] = useState('');
  const [adjustRent, setAdjustRent] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetchRenewal(id)
      .then((r) => {
        setData(r);
        setRent(String(r.tenancy.monthly_rent));
      })
      .catch((e) => setError(errorMessage(e, 'โหลดข้อมูลสัญญาไม่สำเร็จ')));
  }, [id]);

  useEffect(load, [load]);

  async function renew() {
    if (!data) return;
    setBusy(true);
    setError(null);
    try {
      await renewTenancy(id, {
        agreed_months: Number(months),
        ...(adjustRent ? { monthly_rent: Number(rent) } : {}),
      });
      setConfirming(false);
      load();
    } catch (e) {
      setError(errorMessage(e, 'ต่อสัญญาไม่สำเร็จ'));
    } finally {
      setBusy(false);
    }
  }

  const t = data?.tenancy;
  const newStart = t ? new Date(new Date(t.ends_on).getTime() + 86_400_000).toISOString().slice(0, 10) : '';

  return (
    <AppShell screen="S35" title="ต่อสัญญา">
      {error && <Alert>{error}</Alert>}
      {!data && !error && <Loading what="สัญญา" />}

      {data && t && (
        <div className="flex max-w-[860px] flex-col gap-3">
          <Card>
            <div className="flex flex-wrap items-center gap-4">
              <h2 className="money text-xl">ห้อง {t.room_number}</h2>
              <span>{t.tenant_name}</span>
              <span className="money text-text-muted">{t.tenant_phone}</span>
              {t.days_left >= 0 ? (
                <Badge tone={t.days_left <= 30 ? 'warning' : 'neutral'}>ครบกำหนดอีก {t.days_left} วัน</Badge>
              ) : (
                <Badge tone="danger">เลยกำหนดมาแล้ว {-t.days_left} วัน</Badge>
              )}
              <span className="ml-auto text-xs text-text-muted">
                {t.room_type_label} · เริ่ม {thaiDate(t.start_date)} · ครบ {thaiDate(t.ends_on)}
              </span>
            </div>
          </Card>

          {t.renewed_into ? (
            <Card title="ต่อสัญญาไปแล้ว">
              <p className="text-sm">
                สัญญานี้ถูกแทนที่ด้วยสัญญาใหม่ที่เริ่ม {thaiDate(t.renewed_into.start_date)} ·{' '}
                {t.renewed_into.agreed_months} เดือน · ค่าเช่า{' '}
                <span className="money">{baht(t.renewed_into.monthly_rent)}</span>/เดือน
              </p>
              <p className="mt-2 text-xs text-text-muted">
                สัญญาหนึ่งฉบับต่อได้ครั้งเดียว — ถ้าต้องต่ออีก ให้ต่อจากสัญญาฉบับล่าสุด
              </p>
              <Link href={`/tenancies/${t.renewed_into.id}/renew`} className="mt-3 inline-block text-primary underline">
                ไปที่สัญญาฉบับล่าสุด →
              </Link>
            </Card>
          ) : (
            <>
              <Card title="สัญญาเดิม" hint="ปิดที่วันครบกำหนด และไม่ถูกแก้ไข">
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                  <span className="text-text-muted">ค่าเช่าตามสัญญา (ล็อกไว้)</span>
                  <span className="money">{baht(t.monthly_rent)}</span>
                  <span className="text-text-muted">ตกลงอยู่</span>
                  <span>{t.agreed_months} เดือน</span>
                  <span className="text-text-muted">เงินประกัน</span>
                  <span className="money">{baht(t.deposit_amount)}</span>
                  <span className="text-text-muted">ราคามาตรฐานของห้องตอนนี้</span>
                  <span className="money">
                    {baht(t.standard_rent)}
                    {t.standard_rent !== t.monthly_rent && (
                      <span className="ml-1 text-text-muted">— ไม่มีผลกับสัญญาเดิม</span>
                    )}
                  </span>
                </div>
                {data.outstanding_invoices > 0 && (
                  <p className="mt-3 text-sm text-warning">
                    ยังมีบิลค้างอยู่ {data.outstanding_invoices} ใบ — ต่อสัญญาได้ แต่ยอดค้างยังตามผู้เช่าอยู่
                  </p>
                )}
              </Card>

              <Card title="สัญญาใหม่">
                <div className="grid grid-cols-2 gap-4">
                  <Field label="เริ่มสัญญาใหม่" hint="วันถัดจากวันสิ้นสุดสัญญาเดิม">
                    <output className={`${readonlyClass} block`}>{thaiDate(newStart)}</output>
                  </Field>

                  {/* Rule 12: the agreed term is captured again, at this signing —
                      it is not inherited from the contract being replaced. */}
                  <Field label="ตกลงอยู่กี่เดือน" required hint="ใช้วัดการย้ายออกก่อนกำหนดของสัญญาใหม่">
                    <input
                      type="number"
                      min={1}
                      required
                      className={`${inputClass} money`}
                      value={months}
                      onChange={(e) => setMonths(e.target.value)}
                    />
                  </Field>

                  <div className="flex flex-col gap-1">
                    <span className="text-text-muted">ค่าเช่า / เดือน (สัญญาใหม่)</span>
                    {adjustRent ? (
                      <input
                        type="number"
                        min={0}
                        className={`${inputClass} money`}
                        value={rent}
                        onChange={(e) => setRent(e.target.value)}
                      />
                    ) : (
                      <output className={`${readonlyClass} money block`}>{baht(t.monthly_rent)}</output>
                    )}
                    <label className="mt-1 flex items-center gap-2 text-xs text-text-muted">
                      <input
                        type="checkbox"
                        checked={adjustRent}
                        onChange={(e) => {
                          setAdjustRent(e.target.checked);
                          if (!e.target.checked) setRent(String(t.monthly_rent));
                        }}
                      />
                      ปรับค่าเช่าในสัญญาใหม่
                    </label>
                    <span className="text-xs text-text-muted">
                      ค่าตั้งต้นคือค่าเช่าเดิม ไม่ใช่ราคามาตรฐานปัจจุบัน — การขึ้นราคาต้องตั้งใจเสมอ
                    </span>
                  </div>

                  {/* Rule 5: the same money, carried across. Nothing is collected
                      at a renewal, so this is deliberately not an input. */}
                  <Field label="เงินประกัน" hint="ยกยอดจากสัญญาเดิม — ไม่เก็บเพิ่ม">
                    <output className={`${readonlyClass} money block`}>{baht(t.deposit_amount)} (ยกยอดมา)</output>
                  </Field>
                </div>

                <p className="mt-3 rounded border border-info bg-[var(--info-soft)] px-3 py-2 text-xs">
                  ต่อสัญญา = <strong>ทำสัญญาใหม่</strong> ไม่ใช่การขยายสัญญาเดิม — สัญญาเดิมปิดที่ {thaiDate(t.ends_on)}{' '}
                  สัญญาใหม่เริ่ม {thaiDate(newStart)} เงินประกันยกยอดมา และไม่มีการต่ออัตโนมัติ (กฎ 4.8)
                </p>
              </Card>

              <Card>
                {confirming ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-sm">
                      ปิดสัญญาเดิมที่ {thaiDate(t.ends_on)} และเริ่มสัญญาใหม่ {months} เดือน ค่าเช่า{' '}
                      {baht(Number(adjustRent ? rent : t.monthly_rent))}?
                    </span>
                    <Button type="button" disabled={busy} onClick={renew}>
                      {busy ? 'กำลังบันทึก…' : 'ยืนยันต่อสัญญา'}
                    </Button>
                    <Button variant="ghost" type="button" disabled={busy} onClick={() => setConfirming(false)}>
                      ยกเลิก
                    </Button>
                  </div>
                ) : (
                  <Button type="button" onClick={() => setConfirming(true)} disabled={Number(months) < 1}>
                    ต่อสัญญา
                  </Button>
                )}
              </Card>
            </>
          )}
        </div>
      )}
    </AppShell>
  );
}
