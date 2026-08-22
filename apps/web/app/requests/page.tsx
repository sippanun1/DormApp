'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { Alert, Badge, Button, Card, Field, inputClass, Loading, type Tone } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import {
  createRequest,
  fetchRequests,
  REQUEST_STATUS_LABEL,
  REQUEST_TYPE_LABEL,
  updateRequest,
  type MaintenanceRequest,
  type RequestStatus,
  type RequestType,
} from '@/lib/comms';
import { thaiDate } from '@/lib/format';
import { fetchRooms, type Room } from '@/lib/rooms';

const STATUS_TONE: Record<RequestStatus, Tone> = {
  reported: 'danger',
  assigned: 'info',
  in_progress: 'warning',
  blocked: 'danger',
  resolved: 'success',
};

const NEXT_STATUS: RequestStatus[] = ['reported', 'assigned', 'in_progress', 'blocked', 'resolved'];

/**
 * S42 — เรื่องแจ้งจากผู้เช่า.
 *
 * Never-violate rule 14, visible in what is absent: no parts, no costs, no
 * worker login. Hired technicians have no account (owner, 2026-07-31), so
 * assignment is a NAME the office types — recording who is responsible, not
 * dispatching a job to anyone's device. The office moves the status itself,
 * usually after the ช่าง phones in, and what they said goes in the note.
 *
 * `blocked` is a status rather than a type for the same reason: it describes
 * someone who cannot log in to report it.
 *
 * Requests are recorded by the desk, not submitted by tenants — Phase 1 has no
 * tenant login (§5). A renewal request routes to S35 rather than doing anything
 * itself, because a renewal is a new contract with terms to agree (Rule 4.8).
 */
export default function RequestsPage() {
  const [rows, setRows] = useState<MaintenanceRequest[] | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [filter, setFilter] = useState<'' | RequestStatus>('');
  const [roomId, setRoomId] = useState('');
  const [type, setType] = useState<RequestType>('repair');
  const [detail, setDetail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setRows(null);
    Promise.all([fetchRequests(filter || undefined), fetchRooms()])
      .then(([q, r]) => {
        setRows(q.requests);
        setRooms(r.rooms);
        if (!roomId && r.rooms[0]) setRoomId(r.rooms[0].id);
      })
      .catch((e) => setError(errorMessage(e, 'โหลดเรื่องแจ้งไม่สำเร็จ')));
  }, [filter, roomId]);

  useEffect(load, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createRequest({ room_id: roomId, request_type: type, detail: detail.trim() });
      setDetail('');
      load();
    } catch (err) {
      setError(errorMessage(err, 'บันทึกเรื่องแจ้งไม่สำเร็จ'));
    } finally {
      setBusy(false);
    }
  }

  async function patch(id: string, changes: Parameters<typeof updateRequest>[1]) {
    setError(null);
    try {
      await updateRequest(id, changes);
      load();
    } catch (e) {
      setError(errorMessage(e, 'อัปเดตไม่สำเร็จ'));
    }
  }

  return (
    <AppShell screen="S42" title="เรื่องแจ้งจากผู้เช่า">
      {error && <Alert>{error}</Alert>}

      <Card className="mb-3" title="บันทึกเรื่องแจ้ง">
        <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
          <Field label="ห้อง" required>
            <select className={`${inputClass} money`} value={roomId} onChange={(e) => setRoomId(e.target.value)}>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.room_number}
                  {r.occupant ? ` · ${r.occupant.name}` : ' · ว่าง'}
                </option>
              ))}
            </select>
          </Field>
          <Field label="ประเภท" required>
            <select className={inputClass} value={type} onChange={(e) => setType(e.target.value as RequestType)}>
              {(Object.keys(REQUEST_TYPE_LABEL) as RequestType[]).map((t) => (
                <option key={t} value={t}>
                  {REQUEST_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </Field>
          <div className="min-w-[280px] flex-1">
            <Field label="รายละเอียด" required>
              <input className={inputClass} value={detail} onChange={(e) => setDetail(e.target.value)} />
            </Field>
          </div>
          <Button type="submit" disabled={busy || !detail.trim() || !roomId}>
            บันทึก
          </Button>
        </form>
      </Card>

      <Card className="mb-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setFilter('')}
            className={`rounded-btn border px-3 py-1 text-xs ${
              filter === '' ? 'border-primary bg-primary-soft text-primary' : 'border-border'
            }`}
          >
            ทั้งหมด
          </button>
          {NEXT_STATUS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setFilter(s)}
              className={`rounded-btn border px-3 py-1 text-xs ${
                filter === s ? 'border-primary bg-primary-soft text-primary' : 'border-border'
              }`}
            >
              {REQUEST_STATUS_LABEL[s]}
            </button>
          ))}
          <span className="ml-auto text-xs text-text-muted">ไม่มีการบันทึกค่าอะไหล่หรือค่าซ่อมในหน้านี้</span>
        </div>
      </Card>

      {!rows && !error && <Loading what="เรื่องแจ้ง" />}

      {rows && (
        <div className="flex flex-col gap-3">
          {rows.length === 0 && (
            <Card>
              <p className="text-text-muted">ไม่มีเรื่องแจ้งในสถานะนี้</p>
            </Card>
          )}

          {rows.map((q) => (
            <Card key={q.id}>
              <div className="flex flex-wrap items-center gap-3">
                <span className="money font-medium">ห้อง {q.room_number}</span>
                <span>{REQUEST_TYPE_LABEL[q.request_type]}</span>
                <Badge tone={STATUS_TONE[q.status]}>{REQUEST_STATUS_LABEL[q.status]}</Badge>
                {q.status !== 'resolved' && (
                  <Badge tone={q.hours_waiting >= 24 ? 'danger' : 'neutral'}>
                    รอมาแล้ว {q.hours_waiting} ชม.
                  </Badge>
                )}
                <span className="ml-auto text-xs text-text-muted">
                  {q.tenant_name ?? 'ไม่มีผู้เช่าในห้องนี้'} · แจ้ง {thaiDate(q.reported_at)} · บันทึกโดย{' '}
                  {q.reported_by_name}
                </span>
              </div>

              <p className="mt-2 text-sm">{q.detail}</p>
              {q.note && <p className="mt-1 text-sm text-text-muted">บันทึกเพิ่ม: {q.note}</p>}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <select
                  className={`${inputClass} py-1 text-sm`}
                  value={q.status}
                  onChange={(e) => patch(q.id, { status: e.target.value as RequestStatus })}
                >
                  {NEXT_STATUS.map((s) => (
                    <option key={s} value={s}>
                      {REQUEST_STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>

                {/* A name, not an account: the ช่าง has no login and never will. */}
                <input
                  className={`${inputClass} w-[160px] py-1 text-sm`}
                  placeholder="มอบหมายให้ (ชื่อ)"
                  defaultValue={q.assigned_to ?? ''}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v !== (q.assigned_to ?? '')) patch(q.id, { assigned_to: v || null });
                  }}
                />

                <input
                  className={`${inputClass} min-w-[240px] flex-1 py-1 text-sm`}
                  placeholder="ช่างแจ้งอะไรมา (พิมพ์ตามที่โทรมาบอก)"
                  defaultValue={q.note ?? ''}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v !== (q.note ?? '')) patch(q.id, { note: v || null });
                  }}
                />

                {/* Rule 4.8: the request is a request. The renewal itself is S35. */}
                {q.request_type === 'renewal' && (
                  <Link href="/today" className="text-sm text-primary underline">
                    ไปที่สัญญาใกล้ครบกำหนด →
                  </Link>
                )}
                {q.request_type === 'moveout' && (
                  <Link href="/rooms" className="text-sm text-primary underline">
                    เปิดห้องเพื่อคิดยอดย้ายออก →
                  </Link>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </AppShell>
  );
}
