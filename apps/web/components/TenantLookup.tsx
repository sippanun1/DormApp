'use client';

import { useState } from 'react';
import { ApiError, errorMessage } from '@/lib/api';
import { createTenant, lookupTenant, type Tenant } from '@/lib/stays';
import { Alert, Button, Field, inputClass } from './ui';

/**
 * S05 + S06 + S07 in one control: look a person up by phone, and register them
 * only when the lookup comes back empty.
 *
 * Phone is the universal identifier (there is no email anywhere for a tenant),
 * and the API matches it exactly — deliberately never fuzzy-matching a name,
 * which would silently merge two people. So the sequence is fixed: search
 * first, and creation is only offered after a 404.
 */
export function TenantLookup({
  tenant,
  onPick,
}: {
  tenant: Tenant | null;
  onPick: (tenant: Tenant | null) => void;
}) {
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function search() {
    setBusy(true);
    setError(null);
    setNotFound(false);
    try {
      const res = await lookupTenant(phone.trim());
      onPick(res.tenant);
    } catch (err) {
      // 404 is the ordinary path for a new tenant, not an error to shout about.
      if (err instanceof ApiError && err.status === 404) setNotFound(true);
      else setError(errorMessage(err, 'ค้นหาไม่สำเร็จ'));
    } finally {
      setBusy(false);
    }
  }

  async function register() {
    setBusy(true);
    setError(null);
    try {
      const res = await createTenant({ full_name: name.trim(), phone: phone.trim() });
      onPick(res.tenant);
      setNotFound(false);
    } catch (err) {
      setError(errorMessage(err, 'บันทึกผู้เช่าไม่สำเร็จ'));
    } finally {
      setBusy(false);
    }
  }

  if (tenant) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded border border-success bg-[var(--success-soft)] px-3 py-2">
        <span className="font-medium">{tenant.full_name}</span>
        <span className="money text-text-muted">{tenant.phone}</span>
        <button
          type="button"
          className="ml-auto text-xs text-primary underline"
          onClick={() => {
            onPick(null);
            setPhone('');
            setName('');
            setNotFound(false);
          }}
        >
          เปลี่ยนผู้เช่า
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* A div, not a form: this control is used inside the check-in forms,
          and a nested <form> is invalid HTML — the browser flattens it, which
          breaks hydration and makes ค้นหา submit the contract instead. */}
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Field label="เบอร์โทรศัพท์ผู้เช่า" required hint="ค้นหาด้วยเบอร์โทร — ตรงตัวเท่านั้น">
            <input
              className={`${inputClass} money w-full`}
              type="tel"
              required
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                setNotFound(false);
              }}
              onKeyDown={(e) => {
                // Enter searches, and must not submit the form around us.
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void search();
                }
              }}
              placeholder="08x-xxx-xxxx"
            />
          </Field>
        </div>
        <Button type="button" onClick={search} disabled={busy || phone.trim().length < 9}>
          ค้นหา
        </Button>
      </div>

      {notFound && (
        <div className="flex flex-col gap-3 rounded border border-warning bg-[var(--warning-soft)] p-3">
          <p className="text-sm">ไม่พบผู้เช่าจากเบอร์นี้ — ลงทะเบียนผู้เช่าใหม่</p>
          <Field label="ชื่อ-นามสกุล" required>
            <input className={`${inputClass} w-full`} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          {/* Date of birth and national ID are never required of a walk-in and
              never auto-filled (§5) — the daily flow collects the ID under the
              Hotel Act at check-in instead, where it is legally required. */}
          <Button type="button" onClick={register} disabled={busy || name.trim().length < 1} className="self-start">
            บันทึกผู้เช่าใหม่
          </Button>
        </div>
      )}

      {error && <Alert>{error}</Alert>}
    </div>
  );
}
