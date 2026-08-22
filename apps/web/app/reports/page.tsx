'use client';

import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { Alert, Badge, Card, Loading } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { baht, thaiDate } from '@/lib/format';
import { currentPeriod, periodLabel } from '@/lib/period';
import { METHOD_LABEL } from '@/lib/billing';
import {
  fetchIncome,
  fetchIncomeDetail,
  fetchLineUsage,
  fetchSummary,
  type IncomeDetail,
  type LineUsage,
  type MonthIncome,
  type ReportSummary,
} from '@/lib/reports';

/**
 * S39 + S40 — บันทึกกำไร and the reports that read from it.
 *
 * Nothing here is typed. A payment becomes income the moment the owner verifies
 * its slip (ADR-007), and this screen is that record read back — so there is no
 * add, edit or delete control anywhere on it, and no endpoint behind one. A
 * figure that looks wrong is fixed by fixing the bill it came from; the receipt
 * in the tenant's hands is what the report has to agree with (rule 3).
 *
 * The bars are the month picker as well as the chart, so the headline, the
 * caption and the table cannot fall out of step with each other.
 */
export default function ReportsPage() {
  const [months, setMonths] = useState<MonthIncome[] | null>(null);
  const [selected, setSelected] = useState(currentPeriod());
  const [detail, setDetail] = useState<IncomeDetail | null>(null);
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [line, setLine] = useState<LineUsage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchIncome(6)
      .then((r) => setMonths(r.months))
      .catch((e) => setError(errorMessage(e, 'โหลดรายงานไม่สำเร็จ')));
    // Its own call, and its own failure: a LINE outage or an unconfigured
    // channel must not take the money reports down with it.
    fetchLineUsage()
      .then(setLine)
      .catch(() => setLine(null));
  }, []);

  const load = useCallback((month: string) => {
    setDetail(null);
    Promise.all([fetchIncomeDetail(month), fetchSummary(month)])
      .then(([d, s]) => {
        setDetail(d);
        setSummary(s);
      })
      .catch((e) => setError(errorMessage(e, 'โหลดรายละเอียดไม่สำเร็จ')));
  }, []);

  useEffect(() => load(selected), [selected, load]);

  const peak = Math.max(1, ...(months ?? []).map((m) => m.total));
  const income = summary?.income;

  return (
    <AppShell screen="S39" title="รายงานรายรับ">
      {error && <Alert>{error}</Alert>}

      <Card className="mb-3" title={`เดือน ${periodLabel(selected)}`} hint="ยอดจากสลิปที่ตรวจสอบแล้วเท่านั้น">
        <div className="flex items-end gap-3">
          {(months ?? []).map((m) => {
            const key = m.month.slice(0, 10);
            const active = key === selected;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setSelected(key)}
                className="flex flex-1 flex-col items-center gap-1"
                title={`${periodLabel(key)} · ${baht(m.total)}`}
              >
                <span className="money text-xs text-text-muted">{baht(m.total)}</span>
                <span
                  className={`w-full rounded-t ${active ? 'bg-primary' : 'bg-[var(--info-soft)]'}`}
                  style={{ height: `${Math.max(6, (m.total / peak) * 120)}px` }}
                />
                <span className={`text-xs ${active ? 'font-semibold text-primary' : 'text-text-muted'}`}>
                  {periodLabel(key)}
                </span>
              </button>
            );
          })}
          {months?.length === 0 && <p className="text-text-muted">ยังไม่มีสลิปที่ตรวจสอบแล้ว</p>}
        </div>
      </Card>

      <div className="mb-3 flex flex-wrap gap-3">
        <Card className="flex-1">
          <span className="text-xs text-text-muted">รายรับเดือนนี้</span>
          <p className="money text-2xl font-semibold text-success">{baht(income?.total ?? 0)}</p>
          <span className="text-xs text-text-muted">{income?.slip_count ?? 0} สลิป</span>
        </Card>
        <Card className="flex-1">
          <span className="text-xs text-text-muted">ออกบิลแล้ว</span>
          <p className="money text-2xl font-semibold">{baht(summary?.billing.billed_total ?? 0)}</p>
          <span className="text-xs text-text-muted">
            {summary?.billing.paid_count ?? 0} / {summary?.billing.invoice_count ?? 0} ใบชำระแล้ว
          </span>
        </Card>
        <Card className="flex-1">
          <span className="text-xs text-text-muted">ค้างชำระ</span>
          <p className="money text-2xl font-semibold text-danger">{baht(summary?.billing.unpaid_total ?? 0)}</p>
          <span className="text-xs text-text-muted">เกินกำหนด {summary?.billing.overdue_count ?? 0} ใบ</span>
        </Card>
        <Card className="flex-1">
          <span className="text-xs text-text-muted">ห้องมีผู้พัก</span>
          <p className="money text-2xl font-semibold text-info">
            {summary?.occupancy.occupied_rooms ?? 0} / {summary?.occupancy.total_rooms ?? 0}
          </p>
          <span className="text-xs text-text-muted">นับ ณ ตอนนี้</span>
        </Card>
      </div>

      <Card className="mb-3" title="รายรับแยกตามประเภท" hint="แยกจากบิลที่สลิปนั้นชำระ — รวมกลับได้เท่ายอดที่รับจริง">
        {income && (
          <div className="flex flex-col gap-2">
            {(
              [
                ['ค่าเช่าห้อง', income.rent, 'var(--info)'],
                ['ค่าน้ำ-ค่าไฟ', income.utility, 'var(--success)'],
                ['ค่าปรับล่าช้า', income.late_fee, 'var(--warning)'],
                ['อื่น ๆ', income.other, 'var(--neutral)'],
              ] as const
            ).map(([label, value, color]) => (
              <div key={label} className="flex items-center gap-3 text-sm">
                <span className="w-[110px] text-text-muted">{label}</span>
                <span
                  className="h-[14px] rounded"
                  style={{
                    background: color,
                    width: `${income.total > 0 ? Math.max(1, (value / income.total) * 60) : 0}%`,
                  }}
                />
                <span className="money">{baht(value)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {!detail && !error && <Loading what="รายการ" />}

      {detail && (
        <>
          <Card className="mb-3" title="สลิปที่ตรวจสอบในเดือนนี้" hint={`${detail.payments.length} รายการ · รวม ${baht(detail.total)}`}>
            {detail.payments.length === 0 ? (
              <p className="text-text-muted">ยังไม่มีสลิปที่ตรวจสอบแล้วในเดือนนี้</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-text-muted">
                  <tr>
                    <th className="py-1">บิล</th>
                    <th>ห้อง</th>
                    <th>ผู้เช่า</th>
                    <th>งวด</th>
                    <th>วันที่ตรวจ</th>
                    <th>วิธี</th>
                    <th>ตรวจโดย</th>
                    <th className="text-right">ยอด</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.payments.map((p) => (
                    <tr key={p.id} className="border-t border-border">
                      <td className="money py-2">#{p.invoice_number}</td>
                      <td className="money">{p.room_number}</td>
                      <td>{p.tenant_name}</td>
                      <td>{periodLabel(p.billing_period.slice(0, 10))}</td>
                      <td>{thaiDate(p.verified_at)}</td>
                      <td>{METHOD_LABEL[p.payment_method]}</td>
                      <td>{p.verified_by_name}</td>
                      <td className="money text-right">
                        {baht(p.amount)}
                        {/* The frozen late fee, shown inline rather than as a
                            column of mostly-zeroes (ADR-009). */}
                        {p.late_fee > 0 && (
                          <span className="ml-1 text-xs text-warning">(+{baht(p.late_fee)} ค่าปรับ)</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="mt-3 text-xs text-text-muted">
              แก้ไขที่นี่ไม่ได้ — ทุกบรรทัดคือสลิปที่ตรวจสอบแล้วและออกใบเสร็จให้ผู้เช่าไปแล้ว ถ้าตัวเลขผิดต้องแก้ที่บิล
            </p>
          </Card>

          <Card title="ใครเป็นผู้ตรวจสอบ (§15.4)" hint="ผู้บันทึกเงินกับผู้ยืนยันต้องไม่ใช่คนเดียวกัน (ADR-007)">
            {detail.by_staff.length === 0 ? (
              <p className="text-text-muted">ไม่มีรายการในเดือนนี้</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-text-muted">
                  <tr>
                    <th className="py-1">ผู้ตรวจสอบ</th>
                    <th className="text-right">จำนวนสลิป</th>
                    <th className="text-right">ยอดรวม</th>
                    <th>บันทึกเองและตรวจเอง</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.by_staff.map((s) => (
                    <tr key={s.verified_by_name} className="border-t border-border">
                      <td className="py-2">{s.verified_by_name}</td>
                      <td className="money text-right">{s.slip_count}</td>
                      <td className="money text-right">{baht(s.total)}</td>
                      <td>
                        {s.self_recorded > 0 ? (
                          <Badge tone="warning">{s.self_recorded} รายการ</Badge>
                        ) : (
                          <Badge tone="success">ไม่มี</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          {/* Not money, but the notification channel's only running cost — and
              the number to look at before deciding whether reminders may go
              over LINE as well as bills. */}
          {line && (
            <Card
              title="การแจ้งเตือนทาง LINE"
              hint={`เดือนนี้ · โควตาฟรี ${line.usage.cap} ข้อความ/เดือน`}
              className="mt-3"
            >
              {!line.usage.configured && (
                <Alert kind="info">ยังไม่ได้ตั้งค่าช่อง LINE — ระบบยังบันทึกการแจ้งเตือนในแอปตามปกติ</Alert>
              )}
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
                <span className="text-text-muted">ส่งแล้วเดือนนี้</span>
                <span className="money">
                  {line.usage.used_this_month} / {line.usage.cap}
                </span>
                <span className="text-text-muted">ผู้เช่าที่เชื่อม LINE</span>
                <span className="money">
                  {line.tenants.linked} / {line.tenants.total} คน
                </span>
                <span className="text-text-muted">รอส่ง</span>
                <span className="money">{line.usage.queued}</span>
                <span className="text-text-muted">ส่งไม่สำเร็จ</span>
                <span className="money">
                  {line.usage.failed > 0 ? (
                    <span className="text-danger">{line.usage.failed}</span>
                  ) : (
                    0
                  )}
                </span>
              </div>
              {/* Rule 15 said out loud, where the owner is looking at the cost:
                  a LINE message that never went out changes nothing about
                  whether the tenant was told. */}
              <p className="mt-3 text-xs text-text-muted">
                LINE เป็นสำเนาเท่านั้น — การแจ้งเตือนในแอปคือหลักฐานว่าผู้เช่าได้รับแจ้งแล้ว
                ({line.usage.skipped} ข้อความไม่ได้ส่งทาง LINE เช่น ผู้เช่ายังไม่ได้เชื่อมบัญชีหรือปิดการแจ้งเตือนไว้)
              </p>
            </Card>
          )}
        </>
      )}
    </AppShell>
  );
}
