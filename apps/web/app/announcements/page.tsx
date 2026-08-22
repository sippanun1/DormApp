'use client';

import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { Alert, Badge, Button, Card, Field, inputClass, Loading } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { deleteAnnouncement, fetchAnnouncements, sendAnnouncement, type Announcement } from '@/lib/comms';
import { thaiDate } from '@/lib/format';
import { fetchRooms, type Room } from '@/lib/rooms';
import { useSession } from '@/lib/session';

const FLOORS = [1, 2, 3, 4];

/**
 * S41 — ประกาศถึงผู้เช่า.
 *
 * Never-violate rule 15 is the shape of this form: the in-app notification has
 * no checkbox, because it is not a channel the sender picks — Rule 6.13 makes
 * it the proof a tenant was told, and it cannot be switched off. LINE is the
 * only toggle, it carries a copy, and a tenant with no LINE still receives
 * everything.
 *
 * Targeting is stored as what was chosen (all / floors / rooms), not as an
 * expanded list of recipients. A floor announcement sent in July still reads
 * "ชั้น 3" a year later even though different people live there now — expanding
 * it at send time would rewrite history every time somebody moved. The reach
 * shown is therefore "occupied right now", and says so.
 */
export default function AnnouncementsPage() {
  const { user } = useSession();
  const isOwner = user?.role === 'admin';

  const [list, setList] = useState<Announcement[] | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [targetType, setTargetType] = useState<'all' | 'floor' | 'room'>('all');
  const [floors, setFloors] = useState<number[]>([]);
  const [roomNumbers, setRoomNumbers] = useState<string[]>([]);
  const [sendLine, setSendLine] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    Promise.all([fetchAnnouncements(), fetchRooms()])
      .then(([a, r]) => {
        setList(a.announcements);
        setRooms(r.rooms);
      })
      .catch((e) => setError(errorMessage(e, 'โหลดประกาศไม่สำเร็จ')));
  }, []);

  useEffect(load, [load]);

  const occupied = rooms.filter((r) => r.status !== 'vacant');
  const reach =
    targetType === 'all'
      ? occupied.length
      : targetType === 'floor'
        ? occupied.filter((r) => floors.includes(r.floor)).length
        : occupied.filter((r) => roomNumbers.includes(r.room_number)).length;

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await sendAnnouncement({
        title: title.trim(),
        body: body.trim(),
        target_type: targetType,
        target_floors: floors,
        target_rooms: roomNumbers,
        send_line: sendLine,
      });
      setTitle('');
      setBody('');
      setNote(`ส่งประกาศแล้ว — ในแอปทุกห้องที่เลือก${sendLine ? ' และส่ง LINE ให้ผู้ที่เชื่อมไว้' : ''}`);
      load();
    } catch (err) {
      setError(errorMessage(err, 'ส่งประกาศไม่สำเร็จ'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await deleteAnnouncement(id);
      load();
    } catch (e) {
      setError(errorMessage(e, 'ลบประกาศไม่สำเร็จ'));
    }
  }

  function targetLabel(a: Announcement) {
    if (a.target_type === 'all') return 'ทั้งหอ';
    if (a.target_type === 'floor') return `ชั้น ${a.target_floors.join(', ')}`;
    return `ห้อง ${a.target_rooms.join(', ')}`;
  }

  return (
    <AppShell screen="S41" title="ประกาศ">
      {error && <Alert>{error}</Alert>}
      {note && <Alert kind="success">{note}</Alert>}

      <form onSubmit={send} className="mb-3 flex max-w-[900px] flex-col gap-3">
        <Card title="ประกาศใหม่">
          <div className="flex flex-col gap-3">
            <Field label="หัวข้อ" required>
              <input className={inputClass} required value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label="เนื้อหา" required>
              <textarea rows={3} className={inputClass} required value={body} onChange={(e) => setBody(e.target.value)} />
            </Field>

            <div className="flex flex-col gap-2">
              <span className="text-text-muted">ส่งถึง</span>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ['all', 'ทั้งหอ'],
                    ['floor', 'เลือกทั้งชั้น'],
                    ['room', 'เลือกห้อง'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setTargetType(value)}
                    className={`rounded-btn border px-3 py-1 text-sm ${
                      targetType === value ? 'border-primary bg-primary-soft text-primary' : 'border-border'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {targetType === 'floor' && (
                <div className="flex flex-wrap gap-2">
                  {FLOORS.map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setFloors((s) => (s.includes(f) ? s.filter((x) => x !== f) : [...s, f]))}
                      className={`rounded-btn border px-3 py-1 text-xs ${
                        floors.includes(f) ? 'border-primary bg-primary-soft text-primary' : 'border-border'
                      }`}
                    >
                      ชั้น {f}
                    </button>
                  ))}
                </div>
              )}

              {targetType === 'room' && (
                <div className="flex max-h-[160px] flex-wrap gap-1 overflow-y-auto rounded border border-border p-2">
                  {occupied.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() =>
                        setRoomNumbers((s) =>
                          s.includes(r.room_number) ? s.filter((x) => x !== r.room_number) : [...s, r.room_number],
                        )
                      }
                      className={`money rounded border px-2 py-1 text-xs ${
                        roomNumbers.includes(r.room_number)
                          ? 'border-primary bg-primary-soft text-primary'
                          : 'border-border'
                      }`}
                    >
                      {r.room_number}
                    </button>
                  ))}
                  {occupied.length === 0 && <span className="text-xs text-text-muted">ยังไม่มีห้องที่มีผู้พัก</span>}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-text-muted">ช่องทาง</span>
              {/* Rule 15: disabled and checked, because it is not a choice. */}
              <label className="flex items-center gap-2 text-sm text-text-muted">
                <input type="checkbox" checked disabled /> ในแอป (บังคับ — เป็นหลักฐานว่าผู้เช่าได้รับแจ้ง)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={sendLine} onChange={(e) => setSendLine(e.target.checked)} /> ส่ง LINE
                ด้วย (สำเนา — ไม่มีข้อมูลส่วนตัวหรือสลิป)
              </label>
              <span className="text-xs text-text-muted">
                ผู้เช่าที่ไม่ได้เชื่อม LINE จะยังได้รับในแอปเสมอ — ไม่มีใครพลาดประกาศเพราะไม่มี LINE
              </span>
            </div>

            <div className="flex items-center gap-3">
              <Button type="submit" disabled={busy || !title.trim() || !body.trim() || (targetType === 'floor' && floors.length === 0) || (targetType === 'room' && roomNumbers.length === 0)}>
                ส่งประกาศ
              </Button>
              <span className="text-xs text-text-muted">ถึง {reach} ห้องที่มีผู้พักตอนนี้</span>
            </div>
          </div>
        </Card>
      </form>

      {!list && !error && <Loading what="ประกาศ" />}

      {list && (
        <Card title="ประกาศที่ส่งแล้ว" hint={`${list.length} รายการ`}>
          {list.length === 0 ? (
            <p className="text-text-muted">ยังไม่มีประกาศ</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {list.map((a) => (
                <li key={a.id} className="border-b border-border pb-3 last:border-0">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-medium">{a.title}</span>
                    <Badge tone="neutral">{targetLabel(a)}</Badge>
                    {a.send_line ? (
                      <Badge tone="success">ส่ง LINE ด้วย</Badge>
                    ) : (
                      <Badge tone="neutral">ในแอปเท่านั้น</Badge>
                    )}
                    <span className="ml-auto text-xs text-text-muted">
                      {thaiDate(a.sent_at)} · {a.sent_by_name} · ถึง {a.occupied_rooms_now} ห้องที่มีผู้พักตอนนี้
                    </span>
                    {isOwner && (
                      <button type="button" onClick={() => remove(a.id)} className="text-xs text-danger underline">
                        ลบ
                      </button>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-text-muted">{a.body}</p>
                </li>
              ))}
            </ul>
          )}
          {/* Stated rather than faked: read receipts need a tenant who can log
              in, and tenant self-service is outside Phase 1. */}
          <p className="mt-3 text-xs text-text-muted">
            สถิติ &ldquo;อ่านแล้ว&rdquo; ยังไม่มี — ต้องมีระบบผู้เช่าเข้าสู่ระบบก่อน ซึ่งอยู่นอกขอบเขตเฟส 1
          </p>
        </Card>
      )}
    </AppShell>
  );
}
