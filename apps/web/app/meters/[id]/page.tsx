'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { Alert, Badge, Button, Card, Field, inputClass, Loading, readonlyClass } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { baht, thaiDate } from '@/lib/format';
import { periodLabel } from '@/lib/period';
import { useSession } from '@/lib/session';
import { correctReading, fetchReading, METER_LABEL } from '@/lib/stays';

type Reading = Awaited<ReturnType<typeof fetchReading>>['reading'];

/**
 * S15 — correcting a meter reading. Admin only.
 *
 * The correction is appended, never applied to the original row
 * (`meter_reading_corrections` is append-only under ADR-006, with UPDATE and
 * DELETE revoked on it). So this screen shows both: what was recorded, and what
 * it was corrected to, in that order. A tenant querying a bill is entitled to
 * see that something changed and why — hiding the original would defeat the
 * point of keeping it.
 *
 * A reason is required, because a correction with no reason is indistinguishable
 * from a second mistake.
 */
export default function MeterCorrectionPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useSession();

  const [reading, setReading] = useState<Reading | null>(null);
  const [oldValue, setOldValue] = useState('');
  const [newValue, setNewValue] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetchReading(id)
      .then((r) => {
        setReading(r.reading);
        // Pre-filled with what is on record: a correction usually changes one
        // digit, and retyping both invites a second typo.
        setOldValue(String(Number(r.reading.old_reading)));
        setNewValue(String(Number(r.reading.new_reading)));
      })
      .catch((e) => setError(errorMessage(e, 'โหลดรายการมิเตอร์ไม่สำเร็จ')));
  }, [id]);

  useEffect(load, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await correctReading(id, {
        corrected_old_reading: Number(oldValue),
        corrected_new_reading: Number(newValue),
        reason: reason.trim(),
      });
      setReason('');
      setSaved(true);
      load();
    } catch (err) {
      setError(errorMessage(err, 'บันทึกการแก้ไขไม่สำเร็จ'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell screen="S15" title="แก้ไขเลขมิเตอร์">
      {error && <Alert>{error}</Alert>}
      {!reading && !error && <Loading what="รายการ" />}

      {reading && (
        <div className="flex max-w-[720px] flex-col gap-3">
          <Card
            title={`มิเตอร์${METER_LABEL[reading.meter_type]} · งวด ${periodLabel(reading.reading_period.slice(0, 10))}`}
            hint={`บันทึกเมื่อ ${thaiDate(reading.entered_at)}`}
          >
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
              <span className="text-text-muted">เลขครั้งก่อน (ตามที่บันทึก)</span>
              <span className="money">{Number(reading.old_reading)}</span>
              <span className="text-text-muted">เลขครั้งนี้ (ตามที่บันทึก)</span>
              <span className="money">{Number(reading.new_reading)}</span>
              <span className="text-text-muted">อัตรา</span>
              <span className="money">{baht(reading.rate)} / หน่วย</span>
              <span className="text-text-muted">ค่าใช้จ่ายที่คิดไว้</span>
              <span className="money">{baht(reading.computed_cost)}</span>
            </div>
            {reading.is_estimated && (
              <p className="mt-2">
                <Badge tone="warning">ประมาณการ — มิเตอร์เสีย</Badge>
              </p>
            )}
          </Card>

          {reading.corrections.length > 0 && (
            <Card title="ประวัติการแก้ไข" hint="เพิ่มอย่างเดียว — ลบหรือแก้ทับไม่ได้">
              <ul className="flex flex-col gap-1 text-sm">
                {reading.corrections.map((c, idx) => (
                  <li key={idx} className="border-b border-border py-1 last:border-0">
                    <span className="money">
                      {Number(c.corrected_old_reading)} → {Number(c.corrected_new_reading)}
                    </span>
                    <span className="ml-3 text-text-muted">{thaiDate(c.corrected_at)}</span>
                    <span className="ml-3">เหตุผล: {c.reason}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {user?.role === 'admin' ? (
            <Card title="แก้ไขเลขที่อ่านได้">
              {saved && <Alert kind="success">บันทึกการแก้ไขแล้ว — เลขเดิมยังคงอยู่ในประวัติ</Alert>}
              <form onSubmit={submit} className="mt-2 grid grid-cols-2 gap-4">
                <Field label="เลขครั้งก่อนที่ถูกต้อง" required>
                  <input
                    type="number"
                    required
                    className={`${inputClass} money`}
                    value={oldValue}
                    onChange={(e) => setOldValue(e.target.value)}
                  />
                </Field>
                <Field label="เลขครั้งนี้ที่ถูกต้อง" required>
                  <input
                    type="number"
                    required
                    className={`${inputClass} money`}
                    value={newValue}
                    onChange={(e) => setNewValue(e.target.value)}
                  />
                </Field>
                <div className="col-span-2">
                  <Field label="เหตุผล" required hint="ผู้เช่าเห็นเหตุผลนี้ได้จากบิล">
                    <textarea
                      required
                      rows={2}
                      className={inputClass}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </Field>
                </div>
                <div className="col-span-2 flex items-center gap-3">
                  <Button type="submit" disabled={busy || !reason.trim()}>
                    บันทึกการแก้ไข
                  </Button>
                  <span className="text-xs text-text-muted">
                    บิลที่ออกไปแล้วไม่เปลี่ยนตาม — ต้องออกรายการปรับปรุงแยก (ADR-005)
                  </span>
                </div>
              </form>
            </Card>
          ) : (
            <output className={`${readonlyClass} block`}>แก้ไขเลขมิเตอร์ได้เฉพาะเจ้าของเท่านั้น</output>
          )}

          <Link href="/meters" className="text-primary underline">
            ← กลับไปหน้าจดมิเตอร์
          </Link>
        </div>
      )}
    </AppShell>
  );
}
