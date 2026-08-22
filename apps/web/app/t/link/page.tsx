'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Button, Card, inputClass } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { redeemCode } from '@/lib/tenant';
import { setTenantSession } from '@/lib/tenant-session';

/**
 * Linking a device — the tenant app's only way in (Phase 2).
 *
 * There is no password field and no phone field, and that is the design rather
 * than an omission: `tenants` has no `password_hash`, and the phone number is
 * printed on every bill, so it is an identifier and not a secret. The proof is
 * a code handed over at the desk by staff who can see who they are talking to
 * (owner decision 2026-08-17).
 *
 * There is no LIFF and no LINE Login (owner, 2026-08-21): a LINE account that
 * could reach a tenant's bills would make LINE the record. So this stays the
 * front door, and the same code also binds LINE when sent to the Official
 * Account — one slip, both, and as many devices as the tenant owns (ADR-021).
 */
export default function TenantLinkPage() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await redeemCode(code.trim().toUpperCase());
      setTenantSession(r.token, r.tenant);
      router.replace('/t');
    } catch (err) {
      setError(errorMessage(err, 'เชื่อมบัญชีไม่สำเร็จ'));
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[430px] flex-col justify-center bg-surface px-4">
      <h1 className="mb-1 text-xl font-semibold">อมาใหม่ เรสซิเดนซ์</h1>
      <p className="mb-4 text-sm text-text-muted">สำหรับผู้เช่า — ดูบิลและการแจ้งเตือนของห้องคุณ</p>

      {error && <Alert>{error}</Alert>}

      <Card>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <label className="text-sm font-medium" htmlFor="code">
            รหัสเชื่อมบัญชี (6 หลัก)
          </label>
          <input
            id="code"
            className={`${inputClass} text-center font-mono text-2xl tracking-[0.4em]`}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={6}
            autoCapitalize="characters"
            autoComplete="one-time-code"
            inputMode="text"
            placeholder="ABC234"
          />
          <Button type="submit" disabled={busy || code.trim().length !== 6} className="min-h-[52px] text-base">
            {busy ? 'กำลังเชื่อม…' : 'เชื่อมบัญชี'}
          </Button>
        </form>
      </Card>

      <p className="mt-4 text-center text-sm text-text-muted">
        ยังไม่มีรหัส? ขอรหัสเชื่อมบัญชีจากสำนักงาน — รหัสเดียวใช้ได้ทั้งแอปและ LINE ทุกเครื่องของคุณ จนกว่าจะหมดอายุ
      </p>
    </div>
  );
}
