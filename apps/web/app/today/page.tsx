'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { Alert, Badge, Card, Loading } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { baht, thaiDate } from '@/lib/format';
import { fetchToday, type TodayBoard } from '@/lib/stays';
import { useSession } from '@/lib/session';

/**
 * S28 — the front desk's day.
 *
 * Everything here is a due date the desk would otherwise have to remember:
 * who arrives, who leaves, whose contract runs out, and how much is waiting.
 * The dates are computed against bangkok_today() in the database, not in this
 * browser — a laptop on another timezone must not move "today".
 */
export default function TodayPage() {
  const { user } = useSession();
  const [board, setBoard] = useState<TodayBoard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchToday()
      .then(setBoard)
      .catch((e) => setError(errorMessage(e, 'โหลดข้อมูลวันนี้ไม่สำเร็จ')));
  }, []);

  return (
    <AppShell screen="S28" title="งานวันนี้">
      {error && <Alert>{error}</Alert>}
      {!board && !error && <Loading />}

      {board && (
        <div className="flex max-w-[1000px] flex-col gap-3">
          <div className="flex flex-wrap gap-3">
            <Card className="flex-1">
              <span className="text-xs text-text-muted">เข้าพักวันนี้</span>
              <p className="money text-2xl font-semibold">{board.arrivals.length}</p>
            </Card>
            <Card className="flex-1">
              <span className="text-xs text-text-muted">ออกวันนี้</span>
              <p className="money text-2xl font-semibold">{board.departures.length}</p>
            </Card>
            <Card className="flex-1">
              <span className="text-xs text-text-muted">รอตรวจสอบสลิป</span>
              <p className="money text-2xl font-semibold text-warning">{board.pending_verifications}</p>
              {/* ADR-007: staff can see that slips are waiting, and cannot open
                  the queue — the count is not the queue. */}
              {user?.role === 'admin' && board.pending_verifications > 0 && (
                <Link href="/verify" className="text-xs text-primary underline">
                  เปิดคิวตรวจสอบ →
                </Link>
              )}
            </Card>
            <Card className="flex-1">
              <span className="text-xs text-text-muted">เกินกำหนดชำระ</span>
              <p className="money text-2xl font-semibold text-danger">{board.overdue_invoices}</p>
              <Link href="/invoices?status=unpaid" className="text-xs text-primary underline">
                ดูบิลค้างชำระ →
              </Link>
            </Card>
          </div>

          <Card title="เข้าพักวันนี้" hint="กดเพื่อลงทะเบียนตามกฎหมายโรงแรมและเช็คอิน">
            {board.arrivals.length === 0 ? (
              <p className="text-text-muted">ไม่มีผู้เข้าพักวันนี้</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {board.arrivals.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 border-b border-border py-2 last:border-0">
                    <span className="money font-medium">{a.room_number}</span>
                    <span>{a.tenant_name}</span>
                    <span className="money text-text-muted">{a.tenant_phone}</span>
                    <span className="text-text-muted">
                      {thaiDate(a.check_in_date)} → {thaiDate(a.check_out_date)}
                    </span>
                    <span className="money ml-auto text-text-muted">{baht(a.nightly_rate)}/คืน</span>
                    <Link href={`/bookings/${a.id}/check-in`} className="text-primary underline">
                      เช็คอิน →
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="ออกวันนี้" hint="คืนมัดจำกุญแจที่หน้ารายละเอียดห้อง">
            {board.departures.length === 0 ? (
              <p className="text-text-muted">ไม่มีผู้ออกวันนี้</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {board.departures.map((d) => (
                  <li key={d.id} className="flex items-center gap-3 border-b border-border py-2 last:border-0">
                    <span className="money font-medium">{d.room_number}</span>
                    <span>{d.tenant_name}</span>
                    <span className="text-text-muted">ครบกำหนด {thaiDate(d.check_out_date)}</span>
                    <span className="money ml-auto text-text-muted">มัดจำกุญแจ {baht(d.key_deposit)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card
            title="สัญญาใกล้ครบกำหนด (30 วัน)"
            hint="คำนวณจากวันเริ่มสัญญา + จำนวนเดือนที่ตกลงกันไว้ — การต่อสัญญาคือสัญญาใหม่ ไม่ใช่การขยายสัญญาเดิม"
          >
            {board.expiring.length === 0 ? (
              <p className="text-text-muted">ไม่มีสัญญาที่ใกล้ครบกำหนด</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {board.expiring.map((e) => (
                  <li key={e.id} className="flex items-center gap-3 border-b border-border py-2 last:border-0">
                    <span className="money font-medium">{e.room_number}</span>
                    <span>{e.tenant_name}</span>
                    <span className="money text-text-muted">{e.tenant_phone}</span>
                    <span className="text-text-muted">
                      ครบ {thaiDate(e.ends_on)} · ตกลงไว้ {e.agreed_months} เดือน
                    </span>
                    <span className="ml-auto flex items-center gap-3">
                      <Badge tone={e.days_left <= 7 ? 'danger' : 'warning'}>
                        {e.days_left < 0 ? `เลยมาแล้ว ${-e.days_left} วัน` : `อีก ${e.days_left} วัน`}
                      </Badge>
                      <Link href={`/tenancies/${e.id}/renew`} className="text-primary underline">
                        ต่อสัญญา →
                      </Link>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </AppShell>
  );
}
