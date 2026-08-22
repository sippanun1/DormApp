'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { LinkCodeButton } from '@/components/LinkCodeButton';
import { Alert, Badge, Card, inputClass, Loading } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { fetchDirectory, type DirectoryRow } from '@/lib/admin';
import { thaiDate } from '@/lib/format';

/**
 * S44 — the tenant register: everyone who has ever stayed.
 *
 * This search is fuzzy on purpose, and the check-in lookup deliberately is not.
 * Here a partial name is useful ("who was in 203 last year"); at check-in it
 * would silently merge two people into one identity, which is the one mistake
 * ADR-013's shared `tenants` table exists to prevent.
 */
export default function TenantDirectoryPage() {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<DirectoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchDirectory(q)
        .then((r) => setRows(r.tenants))
        .catch((e) => setError(errorMessage(e, 'ค้นหาผู้เช่าไม่สำเร็จ')));
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  return (
    <AppShell screen="S44" title="ทะเบียนผู้เช่า">
      {error && <Alert>{error}</Alert>}

      <Card className="mb-3">
        <input
          className={`${inputClass} w-full max-w-[420px]`}
          placeholder="ค้นหาด้วยชื่อหรือเบอร์โทร"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </Card>

      {!rows && !error && <Loading what="ผู้เช่า" />}

      {rows && (
        <Card hint={`${rows.length} คน · ผู้ที่กำลังพักอยู่ขึ้นก่อน`}>
          {rows.length === 0 ? (
            <p className="text-text-muted">ไม่พบผู้เช่าที่ตรงกับคำค้น</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-text-muted">
                <tr>
                  <th className="py-1">ชื่อ</th>
                  <th>เบอร์โทร</th>
                  <th>สถานะ</th>
                  <th>ห้อง</th>
                  <th className="text-right">จำนวนครั้งที่พัก</th>
                  <th>แอปผู้เช่า</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id} className="border-t border-border">
                    <td className="py-2">{t.full_name}</td>
                    {/* Phone is the identifier everywhere in this system — there
                        is no email field for a tenant on any screen. */}
                    <td className="money">{t.phone}</td>
                    <td>
                      {t.current_room ? (
                        <Badge tone="info">
                          {t.current_kind === 'monthly' ? 'พักอยู่ (รายเดือน)' : 'พักอยู่ (รายวัน)'}
                        </Badge>
                      ) : (
                        <Badge tone="neutral">เคยพัก</Badge>
                      )}
                    </td>
                    <td className="money">
                      {t.current_room ? (
                        t.current_room
                      ) : t.last_room ? (
                        <span className="text-text-muted">
                          {t.last_room}
                          {t.last_ended_on ? ` · ออก ${thaiDate(t.last_ended_on)}` : ''}
                        </span>
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </td>
                    <td className="money text-right">{t.stay_count}</td>
                    {/* Only for people currently staying: a code lets someone
                        read their own bills, and a former tenant has none to
                        read. The LINE badge is separate from the app session —
                        rule 15 makes LINE a copy, not a way in. */}
                    <td>
                      {t.current_room ? (
                        <LinkCodeButton tenantId={t.id} tenantName={t.full_name} />
                      ) : t.line_linked ? (
                        <Badge tone="neutral">LINE: เชื่อมไว้เดิม</Badge>
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <p className="mt-3 text-xs text-text-muted">
            หมายเหตุ &ldquo;หนีค่าเช่า / ไม่ให้เช่าอีก&rdquo; ที่อยู่ในต้นแบบยังไม่ได้สร้าง — ต้องมีที่เก็บในฐานข้อมูลก่อน{' '}
            <Link href="/audit" className="text-primary underline">
              ดูประวัติการใช้งาน
            </Link>
          </p>
        </Card>
      )}
    </AppShell>
  );
}
