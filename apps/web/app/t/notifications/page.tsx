'use client';

import { useEffect, useState } from 'react';
import { TenantShell } from '@/components/TenantShell';
import { Alert, Card, Loading } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { thaiDate } from '@/lib/format';
import {
  fetchNotificationPrefs,
  fetchTenantNotifications,
  markNotificationRead,
  saveNotificationPref,
  type NotificationEvent,
  type NotificationPref,
  type TenantNotification,
} from '@/lib/tenant';

/**
 * S38 — the notification list, and the LINE toggles.
 *
 * This list IS Rule 6.13's proof, read by the person it names. That is why the
 * in-app toggle below is rendered checked and disabled rather than omitted:
 * `notification_prefs.channel` has `CHECK (channel = 'line')`, so the database
 * has no value that could mean "in-app off" — showing it as an unavailable
 * choice says the rule out loud, and hiding it would just look like an
 * oversight.
 */
const EVENT_LABEL: Record<NotificationEvent, string> = {
  bill_issued: 'บิลใหม่',
  payment_verified: 'ยืนยันการชำระเงิน',
  payment_rejected: 'สลิปไม่ผ่าน',
  announcement: 'ประกาศจากหอพัก',
  due_reminder: 'เตือนก่อนครบกำหนด',
  overdue: 'เกินกำหนดชำระ',
  contract_expiring: 'สัญญาใกล้ครบกำหนด',
};

export default function TenantNotificationsPage() {
  const [rows, setRows] = useState<TenantNotification[] | null>(null);
  const [prefs, setPrefs] = useState<NotificationPref[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchTenantNotifications(), fetchNotificationPrefs()])
      .then(([n, p]) => {
        setRows(n.notifications);
        setPrefs(p.prefs);
      })
      .catch((e) => setError(errorMessage(e, 'โหลดการแจ้งเตือนไม่สำเร็จ')));
  }, []);

  async function open(n: TenantNotification) {
    if (n.read_at) return;
    // Optimistic: read_at is the one column a tenant may write, and the worst
    // case is a dot that disappears early.
    setRows((cur) => cur?.map((r) => (r.id === n.id ? { ...r, read_at: new Date().toISOString() } : r)) ?? cur);
    await markNotificationRead(n.id).catch(() => undefined);
  }

  async function toggle(pref: NotificationPref) {
    setBusy(pref.event);
    try {
      const r = await saveNotificationPref(pref.event, !pref.enabled);
      setPrefs((cur) => cur.map((p) => (p.event === pref.event ? { ...p, ...r.pref, chosen: true } : p)));
    } catch (e) {
      setError(errorMessage(e, 'บันทึกการตั้งค่าไม่สำเร็จ'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <TenantShell title="การแจ้งเตือน">
      {error && <Alert>{error}</Alert>}
      {!rows && !error && <Loading what="การแจ้งเตือน" />}

      {rows && (
        <Card className="mb-3">
          {rows.length === 0 ? (
            <p className="text-sm text-text-muted">ยังไม่มีการแจ้งเตือน</p>
          ) : (
            <ul className="flex flex-col">
              {rows.map((n) => (
                <li key={n.id} className="border-b border-border last:border-0">
                  <button
                    type="button"
                    onClick={() => open(n)}
                    className="flex w-full min-h-[44px] flex-col items-start gap-1 py-3 text-left"
                  >
                    <span className="flex w-full items-center gap-2">
                      {!n.read_at && <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-primary" />}
                      <span className={`text-sm ${n.read_at ? 'text-text-muted' : 'font-semibold'}`}>{n.title}</span>
                      <span className="ml-auto shrink-0 text-xs text-text-muted">{thaiDate(n.created_at)}</span>
                    </span>
                    <span className="text-sm text-text-muted">{n.body}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <Card title="ช่องทางแจ้งเตือน" hint="ในแอปปิดไม่ได้ — เป็นหลักฐานว่าคุณได้รับแจ้งแล้ว">
        <ul className="flex flex-col gap-1">
          <li className="flex min-h-[44px] items-center justify-between">
            <span className="text-sm">แจ้งเตือนในแอป</span>
            <input type="checkbox" checked disabled aria-label="แจ้งเตือนในแอป (ปิดไม่ได้)" className="h-5 w-5" />
          </li>
          {prefs.map((p) => (
            <li key={p.event} className="flex min-h-[44px] items-center justify-between">
              <span className="text-sm">
                LINE — {EVENT_LABEL[p.event]}
                {!p.chosen && <span className="ml-1 text-xs text-text-muted">(ค่าเริ่มต้น)</span>}
              </span>
              <input
                type="checkbox"
                checked={p.enabled}
                disabled={busy === p.event}
                onChange={() => toggle(p)}
                aria-label={`LINE — ${EVENT_LABEL[p.event]}`}
                className="h-5 w-5"
              />
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-text-muted">
          LINE จะส่งเฉพาะยอดเงินและวันครบกำหนด ไม่ส่งสลิปหรือข้อมูลส่วนตัว
        </p>
      </Card>
    </TenantShell>
  );
}
