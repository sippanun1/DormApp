'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { Alert, Badge, Card, Loading } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { fetchAudit, type AuditEntry } from '@/lib/admin';
import { thaiDate } from '@/lib/format';
import { SETTING_LABELS } from '@/lib/settings-labels';

const ACTION_LABEL: Record<string, string> = {
  price_changed: 'เปลี่ยนราคามาตรฐาน',
  price_override: 'ตั้งราคาเฉพาะห้อง',
  rate_added: 'เพิ่มอัตราค่าน้ำ-ค่าไฟ',
  setting_changed: 'แก้ไขการตั้งค่า',
  meter_replaced: 'เปลี่ยนมิเตอร์ (เริ่มเลขใหม่)',
};

const ENTITY_LABEL: Record<string, string> = {
  room_type: 'ประเภทห้อง',
  room: 'ห้อง',
  utility_rate: 'อัตราค่าบริการ',
  system_setting: 'การตั้งค่า',
  meter: 'มิเตอร์',
};

/** `{from: 4500, to: 5000}` reads better than raw JSON to the person who did it. */
function describe(entry: AuditEntry): string {
  const d = entry.detail ?? {};
  const part = (v: unknown): string =>
    v !== null && typeof v === 'object' ? Object.values(v as Record<string, unknown>).join(' / ') : String(v);

  // What changed comes before what it changed to. A settings row records its
  // `key`, and dropping it left nine different policies all reading "7 → 5" —
  // an audit trail that cannot say which figure moved is not evidence of
  // anything.
  if ('from' in d && 'to' in d) {
    const subject = typeof d.key === 'string' ? (SETTING_LABELS[d.key]?.label ?? d.key) : null;
    const change = `${part(d.from)} → ${part(d.to)}`;
    return subject ? `${subject}: ${change}` : change;
  }
  if (entry.action === 'meter_replaced') {
    return `เลขเดิม ${String(d.previous_chain_reading)} → เริ่มใหม่ที่ ${String(d.new_baseline)}`;
  }
  return Object.entries(d)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => `${k}: ${part(v)}`)
    .join(' · ');
}

/**
 * S45 — reading back what the other screens promise to record.
 *
 * Owner-only, and read-only by design: there is no endpoint that edits or
 * deletes a row here, so the screen cannot offer one. An audit trail that its
 * subject can edit is not an audit trail.
 */
export default function AuditPage() {
  const [filter, setFilter] = useState('');
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [types, setTypes] = useState<{ entity_type: string; count: number }[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEntries(null);
    fetchAudit(filter || undefined)
      .then((r) => {
        setEntries(r.entries);
        setTypes(r.entity_types);
      })
      .catch((e) => setError(errorMessage(e, 'โหลดประวัติการใช้งานไม่สำเร็จ')));
  }, [filter]);

  return (
    <AppShell screen="S45" title="ประวัติการใช้งาน">
      {error && <Alert>{error}</Alert>}

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
          {types.map((t) => (
            <button
              key={t.entity_type}
              type="button"
              onClick={() => setFilter(t.entity_type)}
              className={`rounded-btn border px-3 py-1 text-xs ${
                filter === t.entity_type ? 'border-primary bg-primary-soft text-primary' : 'border-border'
              }`}
            >
              {ENTITY_LABEL[t.entity_type] ?? t.entity_type} ({t.count})
            </button>
          ))}
          <span className="ml-auto text-xs text-text-muted">บันทึกอย่างเดียว — แก้ไขหรือลบไม่ได้</span>
        </div>
      </Card>

      {!entries && !error && <Loading what="ประวัติ" />}

      {entries && (
        <Card hint={`${entries.length} รายการล่าสุด`}>
          {entries.length === 0 ? (
            <p className="text-text-muted">ยังไม่มีรายการในช่วงนี้</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-text-muted">
                <tr>
                  <th className="py-1">เมื่อ</th>
                  <th>ผู้ใช้</th>
                  <th>สิ่งที่ทำ</th>
                  <th>รายละเอียด</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-t border-border">
                    <td className="py-2 text-text-muted">{thaiDate(e.created_at)}</td>
                    <td>
                      {e.actor_name}{' '}
                      <Badge tone={e.actor_role === 'admin' ? 'info' : 'neutral'}>
                        {e.actor_role === 'admin' ? 'เจ้าของ' : e.actor_role === 'staff' ? 'พนักงาน' : 'ช่าง'}
                      </Badge>
                    </td>
                    <td>{ACTION_LABEL[e.action] ?? e.action}</td>
                    <td className="money text-text-muted">{describe(e)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </AppShell>
  );
}
