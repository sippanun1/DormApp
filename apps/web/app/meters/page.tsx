'use client';

import Link from 'next/link';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { Alert, Badge, Button, Card, inputClass, Loading } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { baht } from '@/lib/format';
import { currentPeriod, periodLabel, recentPeriods } from '@/lib/period';
import { fetchPendingMeters, saveReadings, type MeterRow, type MeterType } from '@/lib/stays';

/** What the staff member has typed into one room's row, before it is saved. */
interface Draft {
  electric: string;
  water: string;
  electricOpening: string;
  waterOpening: string;
  estimated: boolean;
  confirmOpening: boolean;
  saving?: boolean;
  error?: string | null;
  savedCost?: number | null;
}

const EMPTY: Draft = {
  electric: '',
  water: '',
  electricOpening: '',
  waterOpening: '',
  estimated: false,
  confirmOpening: false,
  savedCost: null,
  error: null,
};

/**
 * S13 — the batch meter sheet (Week 5).
 *
 * One row per room in walking order, both meters on the row: that is how the
 * readings are actually collected, one visit per room. Each row saves on its
 * own, so a half-walked floor is never lost.
 *
 * The previous reading is shown locked for a continuing month — it is last
 * month's closing figure on this tenancy's own chain, which is arithmetic, and
 * the server derives it again and refuses a value that disagrees. At move-in
 * there is no chain yet: the field is blank and the previous tenant's closing
 * value appears only as a reference label, never pre-filled (ADR-008).
 */
export default function MetersPage() {
  const [period, setPeriod] = useState(currentPeriod());
  const [rows, setRows] = useState<MeterRow[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((p: string) => {
    setRows(null);
    fetchPendingMeters(p)
      .then((r) => {
        setRows(r.tenancies);
        setDrafts(Object.fromEntries(r.tenancies.map((t) => [t.tenancy_id, { ...EMPTY }])));
      })
      .catch((e) => setError(errorMessage(e, 'โหลดรายการมิเตอร์ไม่สำเร็จ')));
  }, []);

  useEffect(() => load(period), [period, load]);

  function patch(id: string, changes: Partial<Draft>) {
    setDrafts((d) => ({ ...d, [id]: { ...(d[id] ?? EMPTY), ...changes } }));
  }

  async function save(row: MeterRow) {
    const draft = drafts[row.tenancy_id] ?? EMPTY;
    const entries: Parameters<typeof saveReadings>[1]['readings'] = [];

    for (const type of ['electric', 'water'] as MeterType[]) {
      const value = type === 'electric' ? draft.electric : draft.water;
      if (!value.trim() || row.meters[type].recorded) continue;

      const opening = type === 'electric' ? draft.electricOpening : draft.waterOpening;
      entries.push({
        meter_type: type,
        // Only sent at move-in, where it must come off the physical dial.
        // For a continuing month it is deliberately omitted — the server owns it.
        ...(row.meters[type].is_opening ? { old_reading: Number(opening) } : {}),
        new_reading: Number(value),
        is_estimated: draft.estimated,
        confirm_opening: draft.confirmOpening,
      });
    }

    if (entries.length === 0) return;

    patch(row.tenancy_id, { saving: true, error: null });
    try {
      const res = await saveReadings(row.tenancy_id, { reading_period: period, readings: entries });
      const cost = res.readings.reduce((sum, r) => sum + Number(r.computed_cost), 0);
      patch(row.tenancy_id, { saving: false, savedCost: cost, error: null });
      // Re-read the row's own state rather than assuming: a saved reading
      // becomes the next month's locked previous value.
      const fresh = await fetchPendingMeters(period);
      setRows(fresh.tenancies);
    } catch (err) {
      patch(row.tenancy_id, { saving: false, error: errorMessage(err, 'บันทึกไม่สำเร็จ') });
    }
  }

  const floors = [...new Set((rows ?? []).map((r) => r.floor))].sort();
  const done = (rows ?? []).filter((r) => r.meters.electric.recorded && r.meters.water.recorded).length;

  return (
    <AppShell screen="S13" title="จดมิเตอร์">
      <Card
        className="mb-3"
        title={`งวด ${periodLabel(period)}`}
        hint={rows ? `บันทึกครบแล้ว ${done} จาก ${rows.length} ห้อง` : undefined}
      >
        <div className="flex flex-wrap items-center gap-3">
          <select className={inputClass} value={period} onChange={(e) => setPeriod(e.target.value)}>
            {recentPeriods().map((p) => (
              <option key={p} value={p}>
                {periodLabel(p)}
              </option>
            ))}
          </select>
          <p className="text-xs text-text-muted">
            ค่าไฟ ฿9/หน่วย · ค่าน้ำ ฿25/หน่วย — บันทึกทีละห้อง ไม่ต้องรอจนครบทั้งชั้น
          </p>
        </div>
      </Card>

      {error && <Alert>{error}</Alert>}
      {!rows && !error && <Loading what="ห้อง" />}

      {rows &&
        floors.map((floor) => (
          <Card key={floor} title={`ชั้น ${floor}`} className="mb-3">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-text-muted">
                <tr>
                  <th className="w-[130px] py-1">ห้อง</th>
                  <th className="w-[150px]">ไฟ — ครั้งก่อน</th>
                  <th className="w-[130px]">ไฟ — ครั้งนี้</th>
                  <th className="w-[150px]">น้ำ — ครั้งก่อน</th>
                  <th className="w-[130px]">น้ำ — ครั้งนี้</th>
                  <th>สถานะ</th>
                  <th className="w-[110px]" />
                </tr>
              </thead>
              <tbody>
                {rows
                  .filter((r) => r.floor === floor)
                  .map((row) => {
                    const draft = drafts[row.tenancy_id] ?? EMPTY;
                    const complete = row.meters.electric.recorded && row.meters.water.recorded;

                    return (
                      <tr key={row.tenancy_id} className="border-t border-border align-top">
                        <td className="py-2">
                          <span className="money font-medium">{row.room_number}</span>
                          <span className="block text-xs text-text-muted">{row.tenant_name}</span>
                        </td>

                        {(['electric', 'water'] as MeterType[]).map((type) => {
                          const meter = row.meters[type];
                          const openingValue = type === 'electric' ? draft.electricOpening : draft.waterOpening;
                          const value = type === 'electric' ? draft.electric : draft.water;

                          return (
                            <Fragment key={type}>
                              <td className="py-2 pr-2">
                                {meter.recorded ? (
                                  <span className="money text-text-muted">{meter.recorded.old_reading}</span>
                                ) : meter.is_opening ? (
                                  <>
                                    <input
                                      className={`${inputClass} money w-[110px] py-1`}
                                      inputMode="numeric"
                                      placeholder="อ่านจากมิเตอร์"
                                      value={openingValue}
                                      onChange={(e) =>
                                        patch(row.tenancy_id, {
                                          [type === 'electric' ? 'electricOpening' : 'waterOpening']:
                                            e.target.value,
                                        } as Partial<Draft>)
                                      }
                                    />
                                    {meter.prior_tenant_close !== null && (
                                      // A label, not a value: copying it forward
                                      // is exactly what ADR-008 forbids.
                                      <span className="block text-[11px] text-text-muted">
                                        ผู้เช่าคนก่อนปิดที่ {meter.prior_tenant_close}
                                      </span>
                                    )}
                                  </>
                                ) : (
                                  <span className="money block rounded-btn bg-surface px-2 py-1 text-text-muted">
                                    {meter.previous_reading}
                                  </span>
                                )}
                              </td>

                              <td className="py-2 pr-2">
                                {meter.recorded ? (
                                  // Recorded rows are not editable here — a
                                  // reading is corrected on S15, appended and
                                  // with a reason, never overwritten in place.
                                  <Link
                                    href={`/meters/${meter.recorded.id}`}
                                    className="money text-primary underline"
                                  >
                                    {meter.recorded.new_reading}
                                  </Link>
                                ) : (
                                  <input
                                    className={`${inputClass} money w-[110px] py-1`}
                                    inputMode="numeric"
                                    value={value}
                                    onChange={(e) =>
                                      patch(row.tenancy_id, {
                                        [type]: e.target.value,
                                      } as Partial<Draft>)
                                    }
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        void save(row);
                                      }
                                    }}
                                  />
                                )}
                              </td>
                            </Fragment>
                          );
                        })}

                        <td className="py-2 pr-2">
                          {complete ? (
                            <Badge tone="success">
                              บันทึกแล้ว{' '}
                              {baht(
                                (row.meters.electric.recorded?.computed_cost ?? 0) +
                                  (row.meters.water.recorded?.computed_cost ?? 0),
                              )}
                            </Badge>
                          ) : row.meters.electric.recorded || row.meters.water.recorded ? (
                            <Badge tone="warning">ยังขาดมิเตอร์หนึ่งตัว</Badge>
                          ) : (
                            <label className="flex items-center gap-2 text-xs text-text-muted">
                              <input
                                type="checkbox"
                                checked={draft.estimated}
                                onChange={(e) => patch(row.tenancy_id, { estimated: e.target.checked })}
                              />
                              ประมาณการ (มิเตอร์เสีย)
                            </label>
                          )}
                          {draft.error && (
                            <span className="block text-xs text-danger">
                              {draft.error}
                              {/* The API asks for confirmation when the opening
                                  differs from the previous tenant's close — that
                                  gap is usage nobody is billed for. */}
                              {draft.error.includes('ยืนยัน') && (
                                <label className="mt-1 flex items-center gap-1">
                                  <input
                                    type="checkbox"
                                    checked={draft.confirmOpening}
                                    onChange={(e) => patch(row.tenancy_id, { confirmOpening: e.target.checked })}
                                  />
                                  ยืนยันเลขเริ่มต้นตามที่อ่านได้
                                </label>
                              )}
                            </span>
                          )}
                        </td>

                        <td className="py-2">
                          {!complete && (
                            <Button
                              variant="ghost"
                              type="button"
                              className="px-3 py-1 text-xs"
                              disabled={draft.saving}
                              onClick={() => save(row)}
                            >
                              {draft.saving ? 'กำลังบันทึก…' : 'บันทึก'}
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </Card>
        ))}
    </AppShell>
  );
}
