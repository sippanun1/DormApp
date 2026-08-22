'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { Alert, Badge, Button, Card, Field, inputClass, Loading, readonlyClass } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { fetchRooms, type Room } from '@/lib/rooms';
import { baht, thaiDate } from '@/lib/format';
import { fetchTransferPreview, transferRoom, type TransferPreview } from '@/lib/stays';

/**
 * S37 — ย้ายห้อง. Never-violate rule 13 / Business Rules 10.1–10.4.
 *
 * Three things this screen exists to make un-missable, because all three are
 * counter-intuitive and all three are places a well-meaning person would get it
 * wrong by hand:
 *
 *   * **The contract does not change.** Not a move-out and a move-in — the same
 *     row, the same agreed term, the same deposit. There is no field here for
 *     any of them.
 *   * **The rent does not change, even into a pricier room type.** When the
 *     type differs the screen says so out loud and shows the rent staying put,
 *     rather than leaving staff to notice the absence of a price field.
 *   * **Both meters, both rooms, today.** The old room's closing and the new
 *     room's opening are read on the day of the move, while somebody is
 *     standing in front of them. Rule 10.3's two utility periods on one bill
 *     are the consequence of these four numbers.
 *
 * The previous reading is shown and locked (rule 9). It is only editable in the
 * one case where nothing exists to lock — a transfer inside the move-in month,
 * where ADR-008 says the opening has to come off the physical meter.
 */
export default function TransferPage() {
  const { id } = useParams<{ id: string }>();

  const [data, setData] = useState<TransferPreview['preview'] | null>(null);
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [toRoom, setToRoom] = useState<Room | null>(null);
  const [day, setDay] = useState('');
  const [reason, setReason] = useState('');
  const [closingE, setClosingE] = useState('');
  const [closingW, setClosingW] = useState('');
  const [openingE, setOpeningE] = useState('');
  const [openingW, setOpeningW] = useState('');
  const [fromOpenE, setFromOpenE] = useState('');
  const [fromOpenW, setFromOpenW] = useState('');
  const [confirmOpening, setConfirmOpening] = useState(false);
  const [done, setDone] = useState<Awaited<ReturnType<typeof transferRoom>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetchTransferPreview(id)
      .then((r) => {
        setData(r.preview);
        setDay(r.preview.today.slice(0, 10));
      })
      .catch((e) => setError(errorMessage(e, 'โหลดข้อมูลสัญญาไม่สำเร็จ')));
    fetchRooms()
      .then((r) => setRooms(r.rooms))
      .catch(() => setRooms([]));
  }, [id]);

  useEffect(load, [load]);

  // Only a vacant monthly room can take a monthly contract. The daily side is
  // filtered out here rather than refused after the click, because a room a
  // contract can never move into is not a choice.
  const available = (rooms ?? []).filter(
    (r) => r.rental_type === 'monthly' && r.status === 'vacant' && r.id !== data?.from_room_id,
  );

  /** Null before the first reading exists — the move-in-month case. */
  const needsFromOpening = data !== null && data.previous_electric === null;
  const prevE = data?.previous_electric ?? Number(fromOpenE);
  const prevW = data?.previous_water ?? Number(fromOpenW);

  const usedE = Number(closingE) - prevE;
  const usedW = Number(closingW) - prevW;

  const ready =
    toRoom !== null &&
    day !== '' &&
    closingE !== '' &&
    closingW !== '' &&
    openingE !== '' &&
    openingW !== '' &&
    (!needsFromOpening || (fromOpenE !== '' && fromOpenW !== ''));

  async function submit() {
    if (!toRoom) return;
    setBusy(true);
    setError(null);
    try {
      setDone(
        await transferRoom(id, {
          to_room_id: toRoom.id,
          transferred_on: day,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
          closing_electric: Number(closingE),
          closing_water: Number(closingW),
          opening_electric: Number(openingE),
          opening_water: Number(openingW),
          ...(needsFromOpening
            ? { from_opening_electric: Number(fromOpenE), from_opening_water: Number(fromOpenW) }
            : {}),
          ...(confirmOpening ? { confirm_opening: true } : {}),
        }),
      );
    } catch (e) {
      setError(errorMessage(e, 'ย้ายห้องไม่สำเร็จ'));
      // The server refuses an opening that does not match the last occupant's
      // closing until someone says the meter really did run on. Offering the
      // acknowledgement only after that refusal keeps it from being a checkbox
      // people tick by habit.
      setConfirmOpening(true);
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) {
    return (
      <AppShell screen="S37" title="ย้ายห้อง">
        <Alert>{error}</Alert>
      </AppShell>
    );
  }
  if (!data) {
    return (
      <AppShell screen="S37" title="ย้ายห้อง">
        <Loading what="สัญญา" />
      </AppShell>
    );
  }

  if (done) {
    return (
      <AppShell screen="S37" title="ย้ายห้อง">
        <Card>
          <Alert kind="success">
            ย้าย{data.tenant_name} จากห้อง {done.transfer.from_room} ไปห้อง {done.transfer.to_room} เรียบร้อยแล้ว
          </Alert>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <dt className="text-text-muted">วันที่ย้าย</dt>
            <dd>{thaiDate(done.transfer.transferred_on)}</dd>
            <dt className="text-text-muted">ค่าเช่า</dt>
            <dd>{baht(done.transfer.monthly_rent)} — เท่าเดิม</dd>
          </dl>
          <p className="mt-3 text-sm text-text-muted">
            บิลงวดนี้จะมีค่าน้ำค่าไฟสองช่วง — ห้อง {done.transfer.from_room} ถึงวันที่ย้าย และห้อง{' '}
            {done.transfer.to_room} หลังจากนั้น ยังต้องจดมิเตอร์ห้องใหม่ตอนสิ้นเดือนก่อนออกบิล
          </p>
          <div className="mt-4 flex gap-2">
            <Link href="/rooms">
              <Button variant="ghost">กลับไปผังห้อง</Button>
            </Link>
          </div>
        </Card>
      </AppShell>
    );
  }

  const typeChanged = toRoom !== null && toRoom.room_type !== data.from_type_key;

  return (
    <AppShell screen="S37" title="ย้ายห้อง">
      {error && <Alert>{error}</Alert>}

      <Card title="สัญญาปัจจุบัน">
        <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-text-muted">ผู้เช่า</dt>
            <dd>{data.tenant_name}</dd>
          </div>
          <div>
            <dt className="text-text-muted">ห้องเดิม</dt>
            <dd>
              {data.from_room_number} · {data.from_type_label}
            </dd>
          </div>
          <div>
            <dt className="text-text-muted">ค่าเช่า</dt>
            <dd className="money">{baht(data.monthly_rent)}</dd>
          </div>
          <div>
            <dt className="text-text-muted">เงินประกัน</dt>
            <dd className="money">{baht(data.deposit_amount)}</dd>
          </div>
        </dl>
        {/* Rule 13 as a sentence, not an inference from missing fields. */}
        <p className="mt-3 text-sm text-text-muted">
          ย้ายห้องใช้สัญญาเดิม — ค่าเช่า สัญญากี่เดือน และเงินประกันไม่เปลี่ยน
        </p>
      </Card>

      <Card title="ห้องใหม่">
        {rooms === null ? (
          <Loading what="ห้องว่าง" />
        ) : available.length === 0 ? (
          <p className="text-sm text-text-muted">ไม่มีห้องรายเดือนว่างในขณะนี้</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {available.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setToRoom(r)}
                className={`min-h-[44px] rounded-btn border px-3 py-2 text-sm ${
                  toRoom?.id === r.id ? 'border-primary bg-[var(--primary-soft)]' : 'border-border bg-card'
                }`}
              >
                {r.room_number}
                <span className="ml-1 text-xs text-text-muted">{r.room_type_label}</span>
              </button>
            ))}
          </div>
        )}

        {typeChanged && (
          <Alert kind="info">
            ห้อง {toRoom?.room_number} เป็น{toRoom?.room_type_label} ต่างจากห้องเดิม —{' '}
            <strong>ค่าเช่ายังคิด {baht(data.monthly_rent)} เท่าเดิมตลอดสัญญานี้</strong>
          </Alert>
        )}

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="วันที่ย้าย">
            <input
              type="date"
              className={inputClass}
              value={day}
              max={data.today.slice(0, 10)}
              onChange={(e) => setDay(e.target.value)}
            />
          </Field>
          <Field label="เหตุผล (ถ้ามี)">
            <input
              className={inputClass}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="เช่น ย้ายไปห้องที่เงียบกว่า"
            />
          </Field>
        </div>
      </Card>

      <Card title={`มิเตอร์ห้องเดิม (${data.from_room_number})`}>
        <p className="mb-3 text-sm text-text-muted">
          อ่านเลขปิดของห้องเดิมวันนี้ — ค่าน้ำค่าไฟช่วงนี้จะเข้าบิลงวดนี้
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              ['ไฟ', prevE, closingE, setClosingE, fromOpenE, setFromOpenE, usedE, 'หน่วย'],
              ['น้ำ', prevW, closingW, setClosingW, fromOpenW, setFromOpenW, usedW, 'หน่วย'],
            ] as const
          ).map(([label, prev, closing, setClosing, fromOpen, setFromOpen, used, unit]) => (
            <div key={label} className="rounded border border-border p-3">
              <p className="mb-2 text-sm font-medium">มิเตอร์{label}</p>
              {needsFromOpening ? (
                <Field label="เลขเริ่มต้นตอนเข้าอยู่">
                  {/* No reading exists to lock, so ADR-008 applies: it comes off
                      the physical meter and is typed, never derived. */}
                  <input
                    className={inputClass}
                    inputMode="numeric"
                    value={fromOpen}
                    onChange={(e) => setFromOpen(e.target.value)}
                    placeholder="อ่านจากมิเตอร์"
                  />
                </Field>
              ) : (
                <Field label="เลขครั้งก่อน">
                  {/* Rule 9: auto-filled and locked. */}
                  <div className={readonlyClass}>{prev}</div>
                </Field>
              )}
              <Field label="เลขปิดวันนี้">
                <input
                  className={inputClass}
                  inputMode="numeric"
                  value={closing}
                  onChange={(e) => setClosing(e.target.value)}
                  placeholder="เลขปิด"
                />
              </Field>
              {closing !== '' && Number.isFinite(used) && (
                <p className={`mt-1 text-xs ${used < 0 ? 'text-danger' : 'text-text-muted'}`}>
                  {used < 0 ? 'เลขปิดน้อยกว่าเลขครั้งก่อน' : `ใช้ไป ${used} ${unit}`}
                </p>
              )}
            </div>
          ))}
        </div>
      </Card>

      <Card title={`มิเตอร์ห้องใหม่${toRoom ? ` (${toRoom.room_number})` : ''}`}>
        <p className="mb-3 text-sm text-text-muted">
          อ่านเลขเริ่มต้นของห้องใหม่วันนี้ — สิ้นเดือนจะจดเลขปิดตามปกติ และบิลงวดนี้จะมีสองช่วง
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="มิเตอร์ไฟ — เลขเริ่มต้น">
            <input
              className={inputClass}
              inputMode="numeric"
              value={openingE}
              onChange={(e) => setOpeningE(e.target.value)}
              placeholder="อ่านจากมิเตอร์"
            />
          </Field>
          <Field label="มิเตอร์น้ำ — เลขเริ่มต้น">
            <input
              className={inputClass}
              inputMode="numeric"
              value={openingW}
              onChange={(e) => setOpeningW(e.target.value)}
              placeholder="อ่านจากมิเตอร์"
            />
          </Field>
        </div>
        {confirmOpening && (
          <p className="mt-2 text-xs text-text-muted">
            ยืนยันแล้วว่าเลขเริ่มต้นไม่ตรงกับเลขปิดของผู้เช่าคนก่อน — กดยืนยันย้ายห้องอีกครั้งเพื่อบันทึก
          </p>
        )}
      </Card>

      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={submit} disabled={!ready || busy}>
            {busy ? 'กำลังย้าย…' : 'ยืนยันย้ายห้อง'}
          </Button>
          <Link href="/rooms">
            <Button variant="ghost">ยกเลิก</Button>
          </Link>
          {toRoom && (
            <Badge tone="info">
              {data.from_room_number} → {toRoom.room_number}
            </Badge>
          )}
        </div>
      </Card>
    </AppShell>
  );
}
