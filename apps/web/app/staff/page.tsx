'use client';

import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { Alert, Badge, Button, Card, Field, inputClass, Loading } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import {
  createStaff,
  fetchStaff,
  PERMISSION_LABEL,
  setPermissions,
  updateStaff,
  type PermissionKey,
  type StaffMember,
} from '@/lib/admin';
import { thaiDate } from '@/lib/format';

const ROLE_LABEL: Record<StaffMember['role'], string> = {
  admin: 'เจ้าของ',
  staff: 'พนักงาน',
  worker: 'ช่าง/แม่บ้าน',
};

/**
 * S26 — สิทธิ์การใช้งาน.
 *
 * Rule 6: permissions are per-person checkboxes, and the role names are preset
 * tick-combinations. Choosing a preset here ticks boxes and nothing else — the
 * owner can un-tick any of them immediately afterwards, and the person's role
 * does not change with it.
 *
 * Two powers are deliberately missing from the list, and the screen says so
 * rather than leaving a reviewer to wonder:
 *   ตรวจสอบสลิป — admin-only under ADR-007, enforced again by a database
 *     trigger. A checkbox that could grant it would be a weaker second answer.
 *   ตั้งค่า / ราคา / จัดการผู้ใช้ / ประวัติการใช้งาน — rule 6 calls these
 *     owner-only, so they have no key at all.
 */
export default function StaffPage() {
  const [staff, setStaff] = useState<StaffMember[] | null>(null);
  const [keys, setKeys] = useState<PermissionKey[]>([]);
  const [presets, setPresets] = useState<Record<string, PermissionKey[]>>({});
  const [draft, setDraft] = useState<Record<string, PermissionKey[]>>({});
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', password: '', role: 'staff' as StaffMember['role'] });
  const [newPerms, setNewPerms] = useState<PermissionKey[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetchStaff()
      .then((r) => {
        setStaff(r.staff);
        setKeys(r.permission_keys);
        setPresets(r.presets);
        setDraft(Object.fromEntries(r.staff.map((s) => [s.id, s.permissions])));
      })
      .catch((e) => setError(errorMessage(e, 'โหลดรายชื่อผู้ใช้ไม่สำเร็จ')));
  }, []);

  useEffect(load, [load]);

  function toggle(id: string, key: PermissionKey) {
    setDraft((d) => {
      const current = d[id] ?? [];
      return { ...d, [id]: current.includes(key) ? current.filter((k) => k !== key) : [...current, key] };
    });
  }

  async function save(member: StaffMember) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await setPermissions(member.id, draft[member.id] ?? []);
      setNote(`บันทึกสิทธิ์ของ ${member.name} แล้ว`);
      load();
    } catch (e) {
      setError(errorMessage(e, 'บันทึกสิทธิ์ไม่สำเร็จ'));
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(member: StaffMember) {
    setBusy(true);
    setError(null);
    try {
      await updateStaff(member.id, { is_active: !member.is_active });
      load();
    } catch (e) {
      setError(errorMessage(e, 'เปลี่ยนสถานะไม่สำเร็จ'));
    } finally {
      setBusy(false);
    }
  }

  async function submitNew(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createStaff({ ...form, permissions: newPerms });
      setForm({ name: '', phone: '', password: '', role: 'staff' });
      setNewPerms([]);
      setCreating(false);
      setNote('เพิ่มผู้ใช้แล้ว');
      load();
    } catch (err) {
      setError(errorMessage(err, 'เพิ่มผู้ใช้ไม่สำเร็จ'));
    } finally {
      setBusy(false);
    }
  }

  const changed = (m: StaffMember) => {
    const d = [...(draft[m.id] ?? [])].sort().join(',');
    return d !== [...m.permissions].sort().join(',');
  };

  return (
    <AppShell screen="S26" title="ผู้ใช้และสิทธิ์">
      {error && <Alert>{error}</Alert>}
      {note && <Alert kind="success">{note}</Alert>}

      <Card className="mb-3" title="เพิ่มผู้ใช้">
        {creating ? (
          <form onSubmit={submitNew} className="flex flex-col gap-3">
            <div className="grid grid-cols-4 gap-3">
              <Field label="ชื่อ" required>
                <input className={inputClass} required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field label="เบอร์โทร (ใช้เข้าสู่ระบบ)" required>
                <input className={`${inputClass} money`} required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </Field>
              <Field label="รหัสผ่าน" required hint="อย่างน้อย 8 ตัวอักษร">
                <input type="password" className={inputClass} required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              </Field>
              <Field label="ประเภทบัญชี" hint="เจ้าของเท่านั้นที่ตรวจสอบสลิปได้ (ADR-007)">
                <select className={inputClass} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as StaffMember['role'] })}>
                  <option value="staff">พนักงาน</option>
                  <option value="worker">ช่าง/แม่บ้าน</option>
                  <option value="admin">เจ้าของ</option>
                </select>
              </Field>
            </div>

            {form.role !== 'admin' && (
              <div className="flex flex-col gap-2">
                <span className="text-text-muted">เริ่มจากชุดสิทธิ์สำเร็จรูป (ติ๊กให้เอง แก้ได้ทุกช่อง)</span>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(presets).map(([name, perms]) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => setNewPerms(perms)}
                      className="rounded-btn border border-border px-3 py-1 text-xs"
                    >
                      {name}
                    </button>
                  ))}
                </div>
                <div className="flex flex-col gap-1">
                  {keys.map((k) => (
                    <label key={k} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={newPerms.includes(k)}
                        onChange={() =>
                          setNewPerms((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]))
                        }
                      />
                      {PERMISSION_LABEL[k]}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2">
              <Button type="submit" disabled={busy}>
                บันทึกผู้ใช้
              </Button>
              <Button variant="ghost" type="button" onClick={() => setCreating(false)}>
                ยกเลิก
              </Button>
            </div>
          </form>
        ) : (
          <Button type="button" onClick={() => setCreating(true)}>
            เพิ่มผู้ใช้ใหม่
          </Button>
        )}
      </Card>

      {!staff && !error && <Loading what="ผู้ใช้" />}

      {staff?.map((m) => (
        <Card key={m.id} className="mb-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-medium">{m.name}</span>
            <span className="money text-text-muted">{m.phone}</span>
            <Badge tone={m.role === 'admin' ? 'info' : 'neutral'}>{ROLE_LABEL[m.role]}</Badge>
            {!m.is_active && <Badge tone="danger">ปิดการใช้งาน</Badge>}
            <span className="ml-auto text-xs text-text-muted">เพิ่มเมื่อ {thaiDate(m.created_at)}</span>
            <button type="button" className="text-xs text-danger underline" disabled={busy} onClick={() => toggleActive(m)}>
              {m.is_active ? 'ปิดการใช้งาน' : 'เปิดใช้งาน'}
            </button>
          </div>

          {m.role === 'admin' ? (
            // An admin passes every permission check already, so a tick list on
            // one would be a lie the screen then has to keep telling.
            <p className="mt-3 text-sm text-text-muted">
              เจ้าของมีสิทธิ์ทั้งหมดอยู่แล้ว — รวมถึงตรวจสอบสลิป ตั้งค่าระบบ ราคา จัดการผู้ใช้ และประวัติการใช้งาน
            </p>
          ) : (
            <>
              <div className="mt-3 flex flex-wrap gap-2">
                {Object.entries(presets).map(([name, perms]) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setDraft((d) => ({ ...d, [m.id]: perms }))}
                    className="rounded-btn border border-border px-3 py-1 text-xs"
                  >
                    {name}
                  </button>
                ))}
                <span className="self-center text-xs text-text-muted">
                  ชุดสำเร็จรูปคือการติ๊กช่องให้ ไม่ใช่ประเภทผู้ใช้ — แก้ทีละช่องได้เสมอ
                </span>
              </div>

              <div className="mt-2 grid grid-cols-2 gap-x-6">
                {keys.map((k) => (
                  <label key={k} className="flex items-center gap-2 py-1 text-sm">
                    <input
                      type="checkbox"
                      checked={(draft[m.id] ?? []).includes(k)}
                      onChange={() => toggle(m.id, k)}
                    />
                    {PERMISSION_LABEL[k]}
                  </label>
                ))}
              </div>

              <div className="mt-3 flex items-center gap-3">
                <Button type="button" disabled={busy || !changed(m)} onClick={() => save(m)}>
                  บันทึกสิทธิ์
                </Button>
                {changed(m) && <span className="text-xs text-warning">ยังไม่ได้บันทึก</span>}
              </div>
            </>
          )}
        </Card>
      ))}

      <Card title="สิ่งที่ติ๊กให้ไม่ได้ — และทำไม">
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-text-muted">
          <li>
            <strong>ตรวจสอบสลิป</strong> — เจ้าของเท่านั้น (ADR-007) และฐานข้อมูลบังคับอีกชั้นหนึ่ง
            คนที่รับเงินกับคนที่ยืนยันต้องไม่ใช่คนเดียวกัน
          </li>
          <li>
            <strong>ตั้งค่าระบบ · ราคา · จัดการผู้ใช้ · ประวัติการใช้งาน</strong> — เจ้าของเท่านั้นตามกฎข้อ 6
            จึงไม่มีช่องให้ติ๊ก
          </li>
        </ul>
      </Card>
    </AppShell>
  );
}
