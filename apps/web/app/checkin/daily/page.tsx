'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { TenantLookup } from '@/components/TenantLookup';
import { Alert, Button, Card, Field, inputClass, readonlyClass } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { baht } from '@/lib/format';
import { bangkokToday } from '@/lib/period';
import { fetchRooms, ROOM_TYPE_ICON, type Room } from '@/lib/rooms';
import { createBooking, type Tenant } from '@/lib/stays';

/**
 * S10 — daily booking (Week 3).
 *
 * The nightly rate is read-only, from the room's type (rule 11: the bed decides
 * the price, and no screen lets a price be typed from scratch). Overlapping
 * dates are refused by the EXCLUDE constraint in the database, never by a
 * pre-check here — between a check and a write another desk can take the room.
 * That refusal arrives as a 409 and is shown as S11's conflict message.
 */
function DailyBooking() {
  const params = useSearchParams();
  const router = useRouter();
  const roomId = params.get('room');

  const [room, setRoom] = useState<Room | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [checkIn, setCheckIn] = useState(bangkokToday());
  const [checkOut, setCheckOut] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchRooms()
      .then((r) => setRoom(r.rooms.find((x) => x.id === roomId) ?? null))
      .catch((e) => setError(errorMessage(e, 'โหลดข้อมูลห้องไม่สำเร็จ')));
  }, [roomId]);

  const nights = useMemo(() => {
    if (!checkIn || !checkOut) return 0;
    const ms = new Date(`${checkOut}T00:00:00Z`).getTime() - new Date(`${checkIn}T00:00:00Z`).getTime();
    return Math.round(ms / 86_400_000);
  }, [checkIn, checkOut]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!room || !tenant) return;
    setBusy(true);
    setError(null);
    try {
      const res = await createBooking({
        room_id: room.id,
        tenant_id: tenant.id,
        check_in_date: checkIn,
        check_out_date: checkOut,
      });
      // Straight into registration: a booking is not a stay until the Hotel Act
      // record exists, and that is the next screen with no way around it.
      router.push(`/bookings/${res.booking.id}/check-in`);
    } catch (err) {
      setError(errorMessage(err, 'จองไม่สำเร็จ'));
      setBusy(false);
    }
  }

  if (!roomId) {
    return (
      <AppShell screen="S10" title="จองห้องรายวัน">
        <Card>
          <p className="mb-3">ยังไม่ได้เลือกห้อง</p>
          <Link href="/rooms?pick=daily" className="text-primary underline">
            เลือกห้องว่างรายวัน →
          </Link>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell screen="S10" title="จองห้องรายวัน">
      <form onSubmit={submit} className="flex max-w-[760px] flex-col gap-3">
        <Card title={room ? `ห้อง ${room.room_number}` : 'กำลังโหลดห้อง…'} hint={room?.room_type_label}>
          {room && (
            <div className="flex flex-wrap gap-6 text-sm">
              <span>
                {ROOM_TYPE_ICON[room.room_type]} {room.room_type_label}
              </span>
              <span className="text-text-muted">
                ราคามาตรฐาน <span className="money text-text">{baht(room.nightly)}</span> / คืน
              </span>
              <span className="text-text-muted">รายวัน</span>
            </div>
          )}
        </Card>

        <Card title="ผู้เข้าพัก">
          <TenantLookup tenant={tenant} onPick={setTenant} />
        </Card>

        <Card title="วันที่เข้าพัก">
          <div className="grid grid-cols-3 gap-4">
            <Field label="วันที่เข้า" required>
              <input
                type="date"
                required
                className={inputClass}
                value={checkIn}
                onChange={(e) => setCheckIn(e.target.value)}
              />
            </Field>
            <Field label="วันที่ออก" required>
              <input
                type="date"
                required
                min={checkIn}
                className={inputClass}
                value={checkOut}
                onChange={(e) => setCheckOut(e.target.value)}
              />
            </Field>
            <Field label="ยอดรวม" hint={`${nights > 0 ? nights : 0} คืน × ${room ? baht(room.nightly) : '—'}`}>
              <output className={`${readonlyClass} money block`}>
                {room && nights > 0 ? baht(room.nightly * nights) : '—'}
              </output>
            </Field>
          </div>
        </Card>

        {error && <Alert>{error}</Alert>}

        <div className="flex items-center gap-2">
          <Button type="submit" disabled={busy || !tenant || !room || nights <= 0}>
            จองแล้ว → ลงทะเบียนผู้เข้าพัก
          </Button>
          <Link href="/rooms?pick=daily" className="rounded-btn border border-border px-4 py-2">
            ยกเลิก
          </Link>
        </div>
      </form>
    </AppShell>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <DailyBooking />
    </Suspense>
  );
}
