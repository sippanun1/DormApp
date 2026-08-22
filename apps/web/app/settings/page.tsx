'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { Alert, Button, Card, inputClass, Loading } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { fetchSettings, updateSetting, type Setting } from '@/lib/admin';
import { baht, thaiDate } from '@/lib/format';
import { SETTING_LABELS } from '@/lib/settings-labels';
import { useSession } from '@/lib/session';


export default function SettingsPage() {
  const { user } = useSession();
  const isOwner = user?.role === 'admin';

  const [settings, setSettings] = useState<Setting[] | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchSettings()
      .then((r) => {
        setSettings(r.settings);
        setDraft(Object.fromEntries(r.settings.map((s) => [s.key, s.value])));
      })
      .catch((e) => setError(errorMessage(e, 'โหลดการตั้งค่าไม่สำเร็จ')));
  }, []);

  useEffect(load, [load]);

  async function save(s: Setting) {
    setBusy(s.key);
    setError(null);
    setNote(null);
    try {
      await updateSetting(s.key, draft[s.key] ?? s.value);
      setNote(`บันทึก "${SETTING_LABELS[s.key]?.label ?? s.key}" แล้ว`);
      load();
    } catch (e) {
      setError(errorMessage(e, 'บันทึกไม่สำเร็จ'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <AppShell screen="S43" title="ตั้งค่าระบบ">
      {error && <Alert>{error}</Alert>}
      {note && <Alert kind="success">{note}</Alert>}
      {!settings && !error && <Loading what="การตั้งค่า" />}

      {settings && (
        <div className="flex max-w-[860px] flex-col gap-3">
          <Card title="นโยบายของหอพัก" hint={isOwner ? undefined : 'ดูได้อย่างเดียว — แก้ไขได้เฉพาะเจ้าของ'}>
            <ul className="flex flex-col">
              {settings.map((s) => {
                const meta = SETTING_LABELS[s.key];
                const changed = (draft[s.key] ?? s.value) !== s.value;
                return (
                  <li key={s.key} className="flex flex-wrap items-center gap-3 border-b border-border py-3 last:border-0">
                    <div className="min-w-[240px]">
                      <span>{meta?.label ?? s.key}</span>
                      <span className="block text-xs text-text-muted">{meta?.effect}</span>
                    </div>

                    <input
                      className={`${inputClass} money w-[120px]`}
                      disabled={!isOwner}
                      value={draft[s.key] ?? ''}
                      onChange={(e) => setDraft({ ...draft, [s.key]: e.target.value })}
                    />
                    <span className="text-xs text-text-muted">
                      {meta?.unit === 'money' ? `= ${baht(draft[s.key] ?? s.value)}` : meta?.unit === 'day' ? 'ของเดือน' : ''}
                    </span>

                    {isOwner && (
                      <Button
                        type="button"
                        variant="ghost"
                        className="ml-auto px-3 py-1 text-xs"
                        disabled={!changed || busy === s.key}
                        onClick={() => save(s)}
                      >
                        บันทึก
                      </Button>
                    )}
                    <span className="w-full text-[11px] text-text-muted">
                      แก้ล่าสุด {thaiDate(s.updated_at)}
                      {s.updated_by_name ? ` โดย ${s.updated_by_name}` : ''}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card title="สิ่งที่ตั้งค่าไม่ได้ที่นี่">
            <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-text-muted">
              <li>
                ราคาห้องและอัตราค่าน้ำ-ค่าไฟ อยู่ที่{' '}
                <Link href="/settings/prices" className="text-primary underline">
                  หน้าราคา (S24)
                </Link>{' '}
                — ที่เดียวเท่านั้น
              </li>
              {/* Rule 1 and rule 3 are not policies. They are the shape of the
                  system, and a settings screen that offered to switch them off
                  would be lying about what the server does. */}
              <li>การรับชำระบางส่วน — ระบบไม่รองรับ และไม่ใช่ตัวเลือก</li>
              <li>การคืนค่าปรับที่ล็อกไว้แล้วบนบิลที่ออกใบเสร็จไปแล้ว</li>
              <li>
                สิทธิ์ผู้ใช้รายคน อยู่ที่{' '}
                <Link href="/staff" className="text-primary underline">
                  หน้าผู้ใช้และสิทธิ์ (S26)
                </Link>{' '}
                — ติ๊กรายคน ไม่ใช่ตามตำแหน่ง
              </li>
            </ul>
          </Card>
        </div>
      )}
    </AppShell>
  );
}
