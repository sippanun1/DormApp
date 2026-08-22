'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ApiError } from '@/lib/api';
import { baht } from '@/lib/format';
import { fetchRooms, ROOM_TYPE_ICON, stateClass, type Room } from '@/lib/rooms';
import { useSession } from '@/lib/session';

const FLOORS = [1, 2, 3, 4];
const FLOW_LABEL: Record<string, string> = {
  monthly: 'เช็คอินรายเดือน',
  daily: 'จองห้องรายวัน',
};

function RoomGrid() {
  const params = useSearchParams();
  const { user } = useSession();
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<'all' | 'single' | 'double'>('all');

  // ?pick=monthly|daily → the room picker that starts every check-in flow.
  // No pick param → the plain floor plan.
  const raw = params.get('pick');
  const pick = raw === 'monthly' || raw === 'daily' ? raw : null;
  // Set by the flows that end here, so the desk sees what it just did.
  const checkedIn = params.get('checked_in');

  useEffect(() => {
    fetchRooms()
      .then((r) => setRooms(r.rooms))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'โหลดข้อมูลไม่สำเร็จ'));
  }, []);

  const eligible = (r: Room) =>
    !!pick && r.status === 'vacant' && r.rental_type === pick && (typeFilter === 'all' || r.room_type === typeFilter);

  return (
    <AppShell screen="S03" title="ผังห้อง">
      {checkedIn && (
        <p className="mb-3 rounded border border-success bg-[var(--success-soft)] px-3 py-2 text-success">
          ห้อง {checkedIn} เริ่มเข้าอยู่แล้ว
        </p>
      )}
      <div className="mb-3 rounded border border-border bg-card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <h2 className="text-base">
              {pick ? `เลือกห้องว่าง — ${FLOW_LABEL[pick]}` : 'ผังห้องทั้งหมด'}
            </h2>
            <p className="mt-1 text-xs text-text-muted">
              {pick
                ? `คลิกห้องที่ต้องการ — เฉพาะห้องว่างประเภท${pick === 'monthly' ? 'รายเดือน' : 'รายวัน'}เท่านั้นที่เลือกได้`
                : 'สถานะคำนวณจากสัญญาและการจองที่ใช้งานอยู่'}
            </p>
          </div>

          <div className="ml-auto flex flex-wrap gap-[14px] text-xs text-text-muted">
            <span className="flex items-center gap-[6px]">
              <span className="inline-block h-3 w-3 rounded-[3px] border border-success bg-[var(--success-soft)]" /> ว่าง
            </span>
            <span className="flex items-center gap-[6px]">
              <span className="inline-block h-3 w-3 rounded-[3px] border border-info bg-[var(--info-soft)]" /> มีผู้พัก
            </span>
            <span className="flex items-center gap-[6px]">
              <span className="inline-block h-3 w-3 rounded-[3px] border border-dotted border-warning bg-[var(--warning-soft)]" />{' '}
              จองแล้ว
            </span>
          </div>
        </div>

        <div className="mt-[14px] flex items-center gap-3">
          <span className="text-xs text-text-muted">ประเภทห้อง</span>
          {(
            [
              ['all', 'ทั้งหมด'],
              ['double', '🛏🛏 เตียงคู่'],
              ['single', '🛏 เตียงเดี่ยว'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTypeFilter(value)}
              className={`rounded-btn border px-3 py-1 text-xs ${
                typeFilter === value ? 'border-primary bg-primary-soft text-primary' : 'border-border'
              }`}
            >
              {label}
            </button>
          ))}
          {pick && rooms && (
            <span className="ml-auto text-xs text-text-muted">
              เลือกได้ {rooms.filter(eligible).length} ห้อง
            </span>
          )}
        </div>
      </div>

      <div className="rounded border border-border bg-card p-4">
        {error && <p className="text-danger">{error}</p>}
        {!rooms && !error && <p className="text-text-muted">กำลังโหลด…</p>}

        {rooms &&
          FLOORS.map((floor) => (
            <div key={floor}>
              <div className="mb-[2px] mt-[10px] text-xs font-bold text-text-muted">ชั้น {floor}</div>
              <div className="room-mini-grid">
                {rooms
                  .filter((r) => r.floor === floor)
                  .map((r) => {
                    const classes = [
                      'room-card',
                      stateClass(r.status),
                      pick ? (eligible(r) ? 'pick-ok' : 'pick-off') : '',
                    ].join(' ');

                    // In picker mode the eligible rooms show the price they'd be
                    // booked at; otherwise the bed icon alone (rule 11 — the bed
                    // is the price axis, and every room is a ห้องแอร์).
                    const sub =
                      pick && eligible(r)
                        ? `${ROOM_TYPE_ICON[r.room_type]} ${baht(pick === 'monthly' ? r.rent : r.nightly)}`
                        : ROOM_TYPE_ICON[r.room_type];

                    const title = `ห้อง ${r.room_number} · ${r.room_type_label}${
                      // §5.3: a worker never reaches this page's staff shape,
                      // but the tooltip still carries no money for anyone.
                      r.occupant && user?.role !== 'worker' ? ` · ${r.occupant.name}` : ''
                    }`;

                    // Rule 11 again, this time as navigation: the rental type
                    // chosen on the dashboard decides which flow the click
                    // starts, and an ineligible room is not clickable at all.
                    if (pick && eligible(r)) {
                      return (
                        <Link
                          key={r.id}
                          href={`/checkin/${pick}?room=${r.id}`}
                          className={classes}
                          data-rental={r.rental_type}
                          title={title}
                        >
                          {r.room_number}
                          <span className="room-sub">{sub}</span>
                        </Link>
                      );
                    }

                    // Outside picker mode every room opens its own page (S04):
                    // that is where the actions for its current state live.
                    return (
                      <Link
                        key={r.id}
                        href={`/rooms/${r.id}`}
                        className={classes}
                        data-rental={r.rental_type}
                        title={title}
                      >
                        {r.room_number}
                        <span className="room-sub">{sub}</span>
                      </Link>
                    );
                  })}
              </div>
            </div>
          ))}
      </div>
    </AppShell>
  );
}

export default function RoomsPage() {
  return (
    <Suspense fallback={null}>
      <RoomGrid />
    </Suspense>
  );
}
