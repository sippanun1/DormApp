'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { TenantLookup } from '@/components/TenantLookup';
import { Alert, Button, Card, Field, inputClass, readonlyClass } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { baht } from '@/lib/format';
import { fetchRooms, ROOM_TYPE_ICON, type Room } from '@/lib/rooms';
import { createTenancy, type Tenant } from '@/lib/stays';
import { bangkokToday } from '@/lib/period';

/**
 * S08 — monthly move-in (Week 4).
 *
 * Three rules are visible on this form:
 *   Rule 2  the rent is the room's standard price, shown read-only. Overriding
 *           it is a deliberate act that flags the contract, and once signed the
 *           rent is frozen for the contract's life — there is no edit screen.
 *   Rule 12 "ตกลงอยู่กี่เดือน" is captured here, at signing. It is what early
 *           termination is measured against, so it is required, not optional.
 *   Rule 5  เงินประกัน is the monthly species of deposit. มัดจำกุญแจ belongs to
 *           the daily flow and never appears on this screen.
 */
function MonthlyCheckIn() {
  const params = useSearchParams();
  const router = useRouter();
  const roomId = params.get('room');

  const [room, setRoom] = useState<Room | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [startDate, setStartDate] = useState(bangkokToday());
  const [months, setMonths] = useState('12');
  const [deposit, setDeposit] = useState('');
  const [override, setOverride] = useState(false);
  const [rent, setRent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchRooms()
      .then((r) => {
        const found = r.rooms.find((x) => x.id === roomId) ?? null;
        setRoom(found);
        // Two months' rent is the house default; staff can change it, and the
        // number itself is never typed from scratch out of nowhere.
        if (found) {
          setRent(String(found.rent));
          setDeposit(String(found.rent * 2));
        }
      })
      .catch((e) => setError(errorMessage(e, 'โหลดข้อมูลห้องไม่สำเร็จ')));
  }, [roomId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!room || !tenant) return;
    setBusy(true);
    setError(null);
    try {
      const res = await createTenancy({
        room_id: room.id,
        tenant_id: tenant.id,
        start_date: startDate,
        agreed_months: Number(months),
        deposit_amount: Number(deposit || 0),
        // Sent only when staff deliberately overrode it, so the API decides
        // "overridden" by comparing with the room's own standard price.
        ...(override ? { monthly_rent: Number(rent) } : {}),
      });
      router.push(`/rooms?checked_in=${room.room_number}&tenancy=${res.tenancy.id}`);
    } catch (err) {
      // S09: the conflict case — another staff member took this room first.
      // The database's partial unique index is what refuses it, not this page.
      setError(errorMessage(err, 'ทำสัญญาไม่สำเร็จ'));
      setBusy(false);
    }
  }

  if (!roomId) {
    return (
      <AppShell screen="S08" title="เช็คอินรายเดือน">
        <Card>
          <p className="mb-3">ยังไม่ได้เลือกห้อง</p>
          <Link href="/rooms?pick=monthly" className="text-primary underline">
            เลือกห้องว่างรายเดือน →
          </Link>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell screen="S08" title="เช็คอินรายเดือน">
      <form onSubmit={submit} className="flex max-w-[760px] flex-col gap-3">
        <Card title={room ? `ห้อง ${room.room_number}` : 'กำลังโหลดห้อง…'} hint={room?.room_type_label}>
          {room && (
            <div className="flex flex-wrap gap-6 text-sm">
              <span>
                {ROOM_TYPE_ICON[room.room_type]} {room.room_type_label}
              </span>
              <span className="text-text-muted">
                ราคามาตรฐาน <span className="money text-text">{baht(room.rent)}</span> / เดือน
              </span>
              <span className="text-text-muted">รายเดือน</span>
            </div>
          )}
        </Card>

        <Card title="ผู้เช่า">
          <TenantLookup tenant={tenant} onPick={setTenant} />
        </Card>

        <Card title="รายละเอียดสัญญา">
          <div className="grid grid-cols-2 gap-4">
            <Field label="วันเริ่มสัญญา" required>
              <input
                type="date"
                required
                className={inputClass}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </Field>

            {/* Rule 12 — captured at signing, not derived from anything. */}
            <Field label="ตกลงอยู่กี่เดือน" required hint="ใช้วัดการย้ายออกก่อนกำหนด">
              <input
                type="number"
                min={1}
                required
                className={`${inputClass} money`}
                value={months}
                onChange={(e) => setMonths(e.target.value)}
              />
            </Field>

            {/* Not a <Field>: the override checkbox is a label of its own, and
                a label inside a label is invalid HTML — the browser flattens it
                and hydration then disagrees with the server's markup. */}
            <div className="flex flex-col gap-1">
              <span className="text-text-muted">ค่าเช่า / เดือน</span>
              {override ? (
                <input
                  type="number"
                  min={0}
                  className={`${inputClass} money`}
                  value={rent}
                  onChange={(e) => setRent(e.target.value)}
                />
              ) : (
                <output className={`${readonlyClass} money block`}>{room ? baht(room.rent) : '—'}</output>
              )}
              <label className="mt-1 flex items-center gap-2 text-xs text-text-muted">
                <input
                  type="checkbox"
                  checked={override}
                  onChange={(e) => {
                    setOverride(e.target.checked);
                    if (!e.target.checked && room) setRent(String(room.rent));
                  }}
                />
                กำหนดราคาพิเศษสำหรับสัญญานี้
              </label>
              <span className="text-xs text-text-muted">
                {override ? 'ต่างจากราคามาตรฐาน — สัญญาจะถูกทำเครื่องหมายไว้' : 'ตามราคามาตรฐานของประเภทห้อง'}
              </span>
            </div>

            {/* Rule 5: เงินประกัน — never merged with มัดจำกุญแจ. */}
            <Field label="เงินประกัน" hint="คืนเมื่อย้ายออก หักตามความเสียหาย ไม่ต่ำกว่า ฿0">
              <input
                type="number"
                min={0}
                className={`${inputClass} money`}
                value={deposit}
                onChange={(e) => setDeposit(e.target.value)}
              />
            </Field>
          </div>
        </Card>

        {error && <Alert>{error}</Alert>}

        <div className="flex items-center gap-2">
          <Button type="submit" disabled={busy || !tenant || !room}>
            เริ่มเข้าอยู่
          </Button>
          <Link href="/rooms?pick=monthly" className="rounded-btn border border-border px-4 py-2">
            ยกเลิก
          </Link>
          {!tenant && <span className="text-xs text-text-muted">เลือกผู้เช่าก่อนจึงจะทำสัญญาได้</span>}
        </div>
      </form>
    </AppShell>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <MonthlyCheckIn />
    </Suspense>
  );
}
