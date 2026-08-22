'use client';

import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { Alert, Badge, Button, Card, Field, inputClass, Loading } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import {
  addRate,
  fetchRates,
  fetchRoomTypes,
  updateRoomTypePrice,
  type RoomType,
  type UtilityRate,
} from '@/lib/admin';
import { baht, thaiDate } from '@/lib/format';
import { bangkokToday } from '@/lib/period';
import { fetchRooms, ROOM_TYPE_ICON, type Room } from '@/lib/rooms';
import { useSession } from '@/lib/session';

/**
 * S24 — the only place a standard price exists.
 *
 * Rule 11: no screen lets a price be typed from scratch; a room takes its
 * type's price and may only be *overridden*, visibly. Rule 2: changing a
 * standard price moves what future contracts start at, and cannot reach a
 * contract already signed — the frozen rent lives on the tenancy row and
 * nothing here touches it.
 *
 * Utility rates are effective-dated rather than edited. A meter reading froze
 * its own rate when it was entered, so a new rate never rewrites an issued
 * bill, and the history stays answerable when a tenant asks why this month
 * costs more.
 */
export default function PricesPage() {
  const { user } = useSession();
  const isOwner = user?.role === 'admin';

  const [types, setTypes] = useState<RoomType[] | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [rates, setRates] = useState<UtilityRate[]>([]);
  const [draft, setDraft] = useState<Record<string, { rent: string; nightly: string }>>({});
  const [newRate, setNewRate] = useState({ meter_type: 'electric' as 'electric' | 'water', rate: '', from: bangkokToday() });
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [t, r, ra] = await Promise.all([fetchRoomTypes(), fetchRooms(), fetchRates()]);
      setTypes(t.room_types);
      setRooms(r.rooms);
      setRates(ra.rates);
      setDraft(
        Object.fromEntries(
          t.room_types.map((x) => [x.id, { rent: String(x.default_rent), nightly: String(x.default_nightly) }]),
        ),
      );
    } catch (e) {
      setError(errorMessage(e, 'โหลดข้อมูลราคาไม่สำเร็จ'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function savePrice(t: RoomType) {
    const d = draft[t.id];
    if (!d) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await updateRoomTypePrice(t.id, { default_rent: Number(d.rent), default_nightly: Number(d.nightly) });
      setNote(`บันทึกราคามาตรฐานของ${t.name_th}แล้ว — มีผลกับสัญญาใหม่เท่านั้น`);
      await load();
    } catch (e) {
      setError(errorMessage(e, 'บันทึกราคาไม่สำเร็จ'));
    } finally {
      setBusy(false);
    }
  }

  async function submitRate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await addRate({
        meter_type: newRate.meter_type,
        rate: Number(newRate.rate),
        effective_from: newRate.from,
      });
      setNewRate({ ...newRate, rate: '' });
      setNote('เพิ่มอัตราใหม่แล้ว — บิลที่ออกไปแล้วใช้อัตราเดิมที่บันทึกไว้ในแต่ละรายการ');
      await load();
    } catch (err) {
      setError(errorMessage(err, 'เพิ่มอัตราไม่สำเร็จ'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell screen="S24" title="ราคาและอัตราค่าบริการ">
      {error && <Alert>{error}</Alert>}
      {note && <Alert kind="success">{note}</Alert>}
      {!types && !error && <Loading what="ราคา" />}

      {types && (
        <div className="flex max-w-[1000px] flex-col gap-3">
          <Card
            title="ราคามาตรฐานตามประเภทห้อง"
            hint="ทุกห้องเป็นห้องแอร์ — ราคาต่างกันที่เตียง ไม่ใช่แอร์"
          >
            <div className="flex flex-wrap gap-3">
              {types.map((t) => {
                const count = rooms.filter((r) => r.room_type === t.type_key).length;
                const d = draft[t.id] ?? { rent: '', nightly: '' };
                return (
                  <div key={t.id} className="flex min-w-[280px] flex-1 flex-col gap-2 rounded border border-border p-3">
                    <div className="flex items-center gap-2">
                      <span className="text-base">
                        {ROOM_TYPE_ICON[t.type_key]} {t.name_th}
                      </span>
                      <span className="ml-auto text-xs text-text-muted">{count} ห้อง</span>
                    </div>

                    <Field label="ค่าเช่า / เดือน">
                      <input
                        type="number"
                        min={0}
                        disabled={!isOwner}
                        className={`${inputClass} money`}
                        value={d.rent}
                        onChange={(e) => setDraft({ ...draft, [t.id]: { ...d, rent: e.target.value } })}
                      />
                    </Field>
                    <Field label="ค่าห้อง / คืน">
                      <input
                        type="number"
                        min={0}
                        disabled={!isOwner}
                        className={`${inputClass} money`}
                        value={d.nightly}
                        onChange={(e) => setDraft({ ...draft, [t.id]: { ...d, nightly: e.target.value } })}
                      />
                    </Field>

                    {isOwner && (
                      <Button
                        type="button"
                        disabled={busy || (Number(d.rent) === t.default_rent && Number(d.nightly) === t.default_nightly)}
                        onClick={() => savePrice(t)}
                      >
                        บันทึกราคา
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Rule 2, said where the button is, not in a help page. */}
            <p className="mt-3 text-xs text-text-muted">
              การเปลี่ยนราคามาตรฐานมีผลกับ<strong>สัญญาใหม่เท่านั้น</strong> — ค่าเช่าของสัญญาที่เซ็นแล้วถูกล็อกไว้ตลอดอายุสัญญา
              และไม่มีหน้าจอใดแก้ไขได้
            </p>
          </Card>

          <Card title="อัตราค่าน้ำ-ค่าไฟ" hint="เพิ่มอัตราใหม่พร้อมวันที่เริ่มใช้ — ไม่แก้อัตราเดิม">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-text-muted">
                <tr>
                  <th className="py-1">ประเภท</th>
                  <th className="text-right">อัตรา / หน่วย</th>
                  <th>เริ่มใช้</th>
                  <th>บันทึกโดย</th>
                  <th>สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {rates.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="py-2">{r.meter_type === 'electric' ? 'ค่าไฟ' : 'ค่าน้ำ'}</td>
                    <td className="money text-right">{baht(r.rate)}</td>
                    <td>{thaiDate(r.effective_from)}</td>
                    <td>{r.created_by_name}</td>
                    <td>
                      {r.is_current ? (
                        <Badge tone="success">ใช้อยู่</Badge>
                      ) : new Date(r.effective_from) > new Date() ? (
                        <Badge tone="warning">รอเริ่มใช้</Badge>
                      ) : (
                        <Badge tone="neutral">เลิกใช้แล้ว</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {isOwner && (
              <form onSubmit={submitRate} className="mt-4 flex flex-wrap items-end gap-3">
                <Field label="ประเภท">
                  <select
                    className={inputClass}
                    value={newRate.meter_type}
                    onChange={(e) => setNewRate({ ...newRate, meter_type: e.target.value as 'electric' | 'water' })}
                  >
                    <option value="electric">ค่าไฟ</option>
                    <option value="water">ค่าน้ำ</option>
                  </select>
                </Field>
                <Field label="อัตราใหม่ / หน่วย" required>
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    required
                    className={`${inputClass} money w-[140px]`}
                    value={newRate.rate}
                    onChange={(e) => setNewRate({ ...newRate, rate: e.target.value })}
                  />
                </Field>
                <Field label="เริ่มใช้วันที่" required>
                  <input
                    type="date"
                    required
                    className={inputClass}
                    value={newRate.from}
                    onChange={(e) => setNewRate({ ...newRate, from: e.target.value })}
                  />
                </Field>
                <Button type="submit" disabled={busy || !newRate.rate}>
                  เพิ่มอัตรา
                </Button>
                <p className="w-full text-xs text-text-muted">
                  บิลที่ออกไปแล้วไม่เปลี่ยนตาม — แต่ละรายการมิเตอร์เก็บอัตราของตัวเองไว้ตั้งแต่วันที่จด
                </p>
              </form>
            )}
          </Card>

          <Card title="ห้องที่ตั้งราคาเฉพาะ" hint="ราคาเฉพาะห้องจะแสดงเป็นข้อยกเว้นเสมอ ไม่ทับราคามาตรฐาน">
            {rooms.filter((r) => r.price_overridden).length === 0 ? (
              <p className="text-text-muted">ทุกห้องใช้ราคามาตรฐานตามประเภทห้อง</p>
            ) : (
              <ul className="flex flex-wrap gap-2 text-sm">
                {rooms
                  .filter((r) => r.price_overridden)
                  .map((r) => (
                    <li key={r.id} className="money rounded border border-warning px-2 py-1">
                      {r.room_number} · {baht(r.rent)}/เดือน · {baht(r.nightly)}/คืน
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
