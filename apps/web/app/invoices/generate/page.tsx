'use client';

import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { Alert, Button, Card, inputClass, Loading } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { baht } from '@/lib/format';
import { currentPeriod, periodLabel, recentPeriods } from '@/lib/period';
import { fetchReady, generateBatch, type ReadyRow } from '@/lib/billing';

/**
 * S16 + S17 — the monthly run (Week 6).
 *
 * "Ready" means both meters are on file for the period (ADR-015). A tenancy
 * missing one is deliberately absent from this list rather than listed and
 * blocked on click: a missing reading belongs on the meter screen, and the two
 * situations must not look the same to staff.
 *
 * The generate step is confirmed, never one click from the list — and the
 * result reports what was skipped and why, because one blocked room must not
 * stop the other 59 on the day the month is run.
 */
export default function GenerateInvoicesPage() {
  const [period, setPeriod] = useState(currentPeriod());
  const [ready, setReady] = useState<ReadyRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Awaited<ReturnType<typeof generateBatch>> | null>(null);

  const load = useCallback((p: string) => {
    setReady(null);
    setResult(null);
    setConfirming(false);
    fetchReady(p)
      .then((r) => setReady(r.ready))
      .catch((e) => setError(errorMessage(e, 'โหลดรายการไม่สำเร็จ')));
  }, []);

  useEffect(() => load(period), [period, load]);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setResult(await generateBatch(period));
      const fresh = await fetchReady(period);
      setReady(fresh.ready);
    } catch (err) {
      setError(errorMessage(err, 'ออกบิลไม่สำเร็จ'));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  const total = (ready ?? []).reduce((sum, r) => sum + r.total_amount, 0);

  return (
    <AppShell screen="S17" title="ออกบิลประจำเดือน">
      <Card className="mb-3" title={`งวด ${periodLabel(period)}`}>
        <div className="flex flex-wrap items-center gap-3">
          <select className={inputClass} value={period} onChange={(e) => setPeriod(e.target.value)}>
            {recentPeriods().map((p) => (
              <option key={p} value={p}>
                {periodLabel(p)}
              </option>
            ))}
          </select>
          <p className="text-xs text-text-muted">
            แสดงเฉพาะห้องที่จดมิเตอร์ครบทั้งน้ำและไฟแล้ว — ห้องที่ยังไม่ครบให้ไปที่หน้าจดมิเตอร์
          </p>
        </div>
      </Card>

      {error && <Alert>{error}</Alert>}
      {!ready && !error && <Loading what="รายการ" />}

      {ready && (
        <Card
          title={`พร้อมออกบิล ${ready.length} ห้อง`}
          hint={ready.length > 0 ? `รวม ${baht(total)}` : undefined}
          className="mb-3"
        >
          {ready.length === 0 ? (
            <p className="text-text-muted">ไม่มีห้องที่พร้อมออกบิลในงวดนี้</p>
          ) : (
            <>
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-text-muted">
                  <tr>
                    <th className="py-1">ห้อง</th>
                    <th>ผู้เช่า</th>
                    <th className="text-right">ค่าเช่า</th>
                    <th className="text-right">ค่าน้ำ+ไฟ</th>
                    <th className="text-right">รวม</th>
                  </tr>
                </thead>
                <tbody>
                  {ready.map((r) => (
                    <tr key={r.tenancy_id} className="border-t border-border">
                      <td className="money py-2">{r.room_number}</td>
                      <td>{r.tenant_name}</td>
                      {/* Rule 2: this is the contract's own rent, not the
                          room's current standard price. */}
                      <td className="money text-right">{baht(r.monthly_rent)}</td>
                      <td className="money text-right">{baht(r.utility_charge)}</td>
                      <td className="money text-right font-medium">{baht(r.total_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="mt-4 flex items-center gap-3">
                {confirming ? (
                  <>
                    <span className="text-sm">
                      ออกบิล {ready.length} ใบ รวม {baht(total)} — ยืนยันหรือไม่?
                    </span>
                    <Button type="button" onClick={run} disabled={busy}>
                      {busy ? 'กำลังออกบิล…' : 'ยืนยันออกบิล'}
                    </Button>
                    <Button variant="ghost" type="button" onClick={() => setConfirming(false)} disabled={busy}>
                      ยกเลิก
                    </Button>
                  </>
                ) : (
                  <Button type="button" onClick={() => setConfirming(true)}>
                    ออกบิลทั้งหมด {ready.length} ห้อง
                  </Button>
                )}
              </div>
            </>
          )}
        </Card>
      )}

      {result && (
        <Card title={`ออกบิลแล้ว ${result.generated_count} ใบ`}>
          <ul className="flex flex-wrap gap-2 text-sm">
            {result.generated.map((g) => (
              <li key={g.invoice_number} className="money rounded border border-border px-2 py-1">
                {g.room_number} · #{g.invoice_number}
              </li>
            ))}
          </ul>

          {result.skipped.length > 0 && (
            <div className="mt-3">
              <p className="mb-1 text-sm font-medium text-warning">ข้ามไป {result.skipped.length} ห้อง</p>
              <ul className="flex flex-col gap-1 text-xs text-text-muted">
                {result.skipped.map((s) => (
                  <li key={s.room_number}>
                    ห้อง {s.room_number} — {s.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}
    </AppShell>
  );
}
