'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ApiError } from '@/lib/api';
import { fetchRooms, type RoomsSummary } from '@/lib/rooms';

function Kpi({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="flex flex-1 flex-col gap-1 rounded border border-border bg-card px-4 py-[14px]">
      <span className="text-xs text-text-muted">{label}</span>
      <span className={`money text-2xl font-semibold ${tone ?? ''}`}>{value}</span>
    </div>
  );
}

export default function DashboardPage() {
  const [summary, setSummary] = useState<RoomsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchRooms()
      .then((r) => setSummary(r.summary))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'โหลดข้อมูลไม่สำเร็จ'));
  }, []);

  return (
    <AppShell screen="S02" title="หน้าหลัก">
      {error && <p className="mb-3 text-danger">{error}</p>}

      <div className="mb-4 flex flex-wrap gap-3">
        <Kpi label="ห้องทั้งหมด" value={summary?.total ?? '—'} />
        <Kpi label="ห้องว่าง" value={summary?.vacant ?? '—'} tone="text-success" />
        <Kpi label="มีผู้พัก" value={summary?.occupied ?? '—'} tone="text-info" />
        <Kpi label="จองแล้ว" value={summary?.reserved ?? '—'} tone="text-warning" />
      </div>

      <div className="mb-4 flex flex-wrap gap-3">
        <div className="flex-1 rounded border border-border bg-card p-4">
          <h2 className="mb-2 text-base">เริ่มงาน</h2>
          <div className="flex flex-wrap gap-2">
            {/* Every check-in starts at the room picker — rental type decides
                which flow, so it is chosen here and carried in the URL. */}
            <Link
              href="/rooms?pick=monthly"
              className="rounded-btn bg-primary px-4 py-2 font-medium text-primary-contrast"
            >
              เช็คอินรายเดือน
            </Link>
            <Link href="/rooms?pick=daily" className="rounded-btn border border-border px-4 py-2 font-medium">
              จองห้องรายวัน
            </Link>
            <Link href="/rooms" className="rounded-btn border border-border px-4 py-2 font-medium">
              ผังห้อง
            </Link>
            <Link href="/today" className="rounded-btn border border-border px-4 py-2 font-medium">
              งานวันนี้
            </Link>
            <Link href="/meters" className="rounded-btn border border-border px-4 py-2 font-medium">
              จดมิเตอร์
            </Link>
            {/* The month's run: meters → ready list → generate. */}
            <Link href="/invoices/generate" className="rounded-btn border border-border px-4 py-2 font-medium">
              ออกบิลประจำเดือน
            </Link>
          </div>
          <p className="mt-3 text-xs text-text-muted">
            {summary
              ? `รายเดือน ${summary.monthly} ห้อง · รายวัน ${summary.daily} ห้อง`
              : 'กำลังโหลด…'}
          </p>
        </div>
      </div>
    </AppShell>
  );
}
