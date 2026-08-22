'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { LinkCodeButton } from '@/components/LinkCodeButton';
import { Alert, Badge, Button, Card, Loading, type Tone } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { fetchInvoices, INVOICE_STATUS_LABEL, type Invoice } from '@/lib/billing';
import { baht, thaiDate } from '@/lib/format';
import { periodLabel } from '@/lib/period';
import { fetchRooms, ROOM_TYPE_ICON, type Room } from '@/lib/rooms';
import { cancelBooking, checkOutBooking, fetchBooking, fetchTenancy } from '@/lib/stays';

type Tenancy = Awaited<ReturnType<typeof fetchTenancy>>['tenancy'];
type Booking = Awaited<ReturnType<typeof fetchBooking>>['booking'];

const STATE: Record<Room['status'], { label: string; tone: Tone }> = {
  vacant: { label: 'ว่าง', tone: 'success' },
  occupied_monthly: { label: 'มีผู้พัก (รายเดือน)', tone: 'info' },
  occupied_daily: { label: 'มีผู้พัก (รายวัน)', tone: 'info' },
  reserved: { label: 'จองแล้ว', tone: 'warning' },
};

/**
 * S04 — one room, and every action that can start from it.
 *
 * Which actions exist depends on the room's state, and the state is computed by
 * the API from active tenancies and bookings — this page never decides it.
 *
 * "ย้ายออก" leads to S27 rather than ending the contract here. Closing a
 * tenancy and settling its deposit are one act (Rule 4.12 + rule 4): a button
 * that only did the first would leave a deposit nobody accounted for, and the
 * refund a tenant was handed would exist in no record.
 */
export default function RoomDetailPage() {
  const { id } = useParams<{ id: string }>();

  const [room, setRoom] = useState<Room | null>(null);
  const [tenancy, setTenancy] = useState<Tenancy | null>(null);
  const [booking, setBooking] = useState<Booking | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [keyDeduction, setKeyDeduction] = useState('0');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const rooms = await fetchRooms();
      const found = rooms.rooms.find((r) => r.id === id) ?? null;
      setRoom(found);
      setTenancy(null);
      setBooking(null);
      setInvoices([]);
      if (found?.tenancy_id) {
        const [t, inv] = await Promise.all([
          fetchTenancy(found.tenancy_id),
          fetchInvoices({ tenancy_id: found.tenancy_id }),
        ]);
        setTenancy(t.tenancy);
        setInvoices(inv.invoices);
      }
      if (found?.booking_id) setBooking((await fetchBooking(found.booking_id)).booking);
    } catch (e) {
      setError(errorMessage(e, 'โหลดข้อมูลห้องไม่สำเร็จ'));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(what: 'check-out' | 'keys-lost' | 'cancel' | 'no-show') {
    setBusy(true);
    setError(null);
    try {
      // Rule 5: มัดจำกุญแจ settles on its own, never merged with เงินประกัน.
      // Keys returned may cost a deduction; keys not returned forfeits it all.
      if (what === 'check-out' && booking) await checkOutBooking(booking.id, true, Number(keyDeduction || 0));
      if (what === 'keys-lost' && booking) await checkOutBooking(booking.id, false);
      if (what === 'cancel' && booking) await cancelBooking(booking.id, false);
      if (what === 'no-show' && booking) await cancelBooking(booking.id, true);
      await load();
    } catch (e) {
      setError(errorMessage(e, 'ดำเนินการไม่สำเร็จ'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell screen="S04" title="รายละเอียดห้อง">
      {error && <Alert>{error}</Alert>}
      {!room && !error && <Loading what="ห้อง" />}

      {room && (
        <div className="flex max-w-[900px] flex-col gap-3">
          <Card>
            <div className="flex flex-wrap items-center gap-4">
              <h2 className="money text-xl">ห้อง {room.room_number}</h2>
              <Badge tone={STATE[room.status].tone}>{STATE[room.status].label}</Badge>
              <span className="text-sm">
                {ROOM_TYPE_ICON[room.room_type]} {room.room_type_label}
              </span>
              {/* Rule 11: the two axes side by side, never merged into one label. */}
              <span className="text-sm text-text-muted">
                {room.rental_type === 'monthly' ? 'รายเดือน' : 'รายวัน'}
              </span>
              <span className="money ml-auto text-sm text-text-muted">
                มาตรฐาน {baht(room.rent)}/เดือน · {baht(room.nightly)}/คืน
                {room.price_overridden && <span className="ml-1 text-warning">(ราคาเฉพาะห้อง)</span>}
              </span>
            </div>
          </Card>

          {room.status === 'vacant' && (
            <Card title="เริ่มการเข้าพัก">
              {/* Rule 11 again: the room's rental type decides which flow exists
                  here at all — the other one is not offered, not just disabled. */}
              <Link
                href={`/checkin/${room.rental_type}?room=${room.id}`}
                className="inline-block rounded-btn bg-primary px-4 py-2 font-medium text-primary-contrast"
              >
                {room.rental_type === 'monthly' ? 'เช็คอินรายเดือน' : 'จองห้องรายวัน'}
              </Link>
            </Card>
          )}

          {tenancy && (
            <Card title="สัญญาปัจจุบัน" hint={`เริ่ม ${thaiDate(tenancy.start_date)}`}>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                <span className="text-text-muted">ผู้เช่า</span>
                <span>
                  {tenancy.tenant_name} · <span className="money">{tenancy.tenant_phone}</span>
                </span>
                <span className="text-text-muted">ค่าเช่าตามสัญญา</span>
                <span className="money">
                  {baht(tenancy.monthly_rent)}
                  {tenancy.rent_overridden && <span className="ml-1 text-warning">(ราคาพิเศษ)</span>}
                </span>
                {/* Rule 2 as history rather than as an error: the room's price
                    may have moved, and this contract's rent still cannot. */}
                {Number(tenancy.room_current_price) !== Number(tenancy.monthly_rent) && (
                  <>
                    <span className="text-text-muted">ราคาห้องปัจจุบัน</span>
                    <span className="money text-text-muted">
                      {baht(tenancy.room_current_price)} — ไม่มีผลกับสัญญานี้
                    </span>
                  </>
                )}
                <span className="text-text-muted">ตกลงอยู่</span>
                <span>{tenancy.agreed_months} เดือน</span>
                <span className="text-text-muted">เงินประกัน</span>
                <span className="money">{baht(tenancy.deposit_amount)}</span>
              </div>

              {/* Phase 5: the tenant's way into their own bills. The code is
                  read aloud here, at the desk, to someone staff can see — which
                  is the whole of the tenant app's security model. */}
              <div className="mt-4 border-t border-border pt-3">
                <p className="mb-2 text-xs text-text-muted">แอปผู้เช่า</p>
                <LinkCodeButton tenantId={tenancy.tenant_id} tenantName={tenancy.tenant_name} />
              </div>

              <div className="mt-4 flex items-center gap-2">
                {/* Ending a contract and settling its deposit are one act, so
                    there is one route to it: S27 closes the tenancy in the same
                    request that records the refund. A bare "end contract"
                    button would leave a deposit nobody accounted for. */}
                {/* Rule 4.8: renewing is a new contract, so it sits beside the
                    move-out rather than inside it — they are the two ways a
                    contract can end, and neither edits the row in place. */}
                <Link
                  href={`/tenancies/${tenancy.id}/renew`}
                  className="rounded-btn bg-primary px-4 py-2 font-medium text-primary-contrast"
                >
                  ต่อสัญญา
                </Link>
                {/* Rule 13: a transfer is neither of those — the contract does
                    not end and does not restart, only the room number changes.
                    It sits between them because that is what staff are choosing
                    between when a tenant asks to move. */}
                <Link
                  href={`/tenancies/${tenancy.id}/transfer`}
                  className="rounded-btn border border-border px-4 py-2 font-medium"
                >
                  ย้ายห้อง
                </Link>
                <Link
                  href={`/tenancies/${tenancy.id}/checkout`}
                  className="rounded-btn border border-danger px-4 py-2 font-medium text-danger"
                >
                  ย้ายออก / คิดยอดเงินประกัน
                </Link>
              </div>
            </Card>
          )}

          {booking && (
            <Card title="การจองรายวัน" hint={booking.status === 'checked_in' ? 'เข้าพักอยู่' : 'จองแล้ว'}>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                <span className="text-text-muted">ผู้เข้าพัก</span>
                <span>
                  {booking.tenant_name} · <span className="money">{booking.tenant_phone}</span>
                </span>
                <span className="text-text-muted">ช่วงวันที่</span>
                <span>
                  {thaiDate(booking.check_in_date)} → {thaiDate(booking.check_out_date)}
                </span>
                <span className="text-text-muted">ค่าห้อง</span>
                <span className="money">{baht(booking.nightly_rate)} / คืน</span>
                {/* Rule 5: มัดจำกุญแจ, kept separate from เงินประกัน above. */}
                <span className="text-text-muted">มัดจำกุญแจ</span>
                <span className="money">{baht(booking.key_deposit)}</span>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                {booking.status === 'confirmed' && (
                  <Link
                    href={`/bookings/${booking.id}/check-in`}
                    className="rounded-btn bg-primary px-4 py-2 font-medium text-primary-contrast"
                  >
                    ลงทะเบียนและเช็คอิน
                  </Link>
                )}
                {booking.status === 'checked_in' && (
                  <>
                    <label className="flex items-center gap-2 text-xs text-text-muted">
                      หักจากมัดจำกุญแจ
                      <input
                        type="number"
                        min={0}
                        max={booking.key_deposit}
                        className="w-[90px] rounded-btn border border-border px-2 py-1 text-right"
                        value={keyDeduction}
                        onChange={(e) => setKeyDeduction(e.target.value)}
                      />
                    </label>
                    <Button type="button" disabled={busy} onClick={() => act('check-out')}>
                      เช็คเอาต์ · คืน {baht(Math.max(0, booking.key_deposit - Number(keyDeduction || 0)))}
                    </Button>
                    <Button variant="danger" type="button" disabled={busy} onClick={() => act('keys-lost')}>
                      ไม่ได้คืนกุญแจ (ริบมัดจำ)
                    </Button>
                  </>
                )}
                {booking.status === 'confirmed' && (
                  <>
                    <Button variant="ghost" type="button" disabled={busy} onClick={() => act('cancel')}>
                      ยกเลิกการจอง
                    </Button>
                    {/* Rule 8: a manual act, with forfeit of whatever was paid —
                        never a timer that decides on the guest's behalf. */}
                    <Button variant="danger" type="button" disabled={busy} onClick={() => act('no-show')}>
                      ไม่มาเข้าพัก (ริบเงินมัดจำ)
                    </Button>
                  </>
                )}
              </div>
            </Card>
          )}

          {invoices.length > 0 && (
            <Card title="บิลของสัญญานี้">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-text-muted">
                  <tr>
                    <th className="py-1">เลขที่</th>
                    <th>งวด</th>
                    <th className="text-right">ต้องชำระ</th>
                    <th>สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((i) => (
                    <tr key={i.id} className="border-t border-border">
                      <td className="money py-2">
                        <Link href={`/invoices/${i.id}`} className="text-primary underline">
                          #{i.invoice_number}
                        </Link>
                      </td>
                      <td>{periodLabel(i.billing_period.slice(0, 10))}</td>
                      <td className="money text-right">{baht(i.amount_due)}</td>
                      <td>{INVOICE_STATUS_LABEL[i.status]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          <Link href="/rooms" className="text-primary underline">
            ← กลับไปผังห้อง
          </Link>
        </div>
      )}
    </AppShell>
  );
}
