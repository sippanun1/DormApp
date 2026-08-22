'use client';

import { useEffect, useState } from 'react';
import { Badge, Button } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import {
  extendLinkCode,
  fetchLinkStatus,
  issueLinkCode,
  revokeLinkCode,
  type LinkCode,
  type LinkStatus,
} from '@/lib/admin';

/**
 * Phase 5 — issuing a tenant's link code from the desk (S04 and S44).
 *
 * The code is how a tenant gets in. There is no password anywhere in the tenant
 * app and no SMS: staff read six characters to a person standing in front of
 * them, and that person's devices are signed in. So this component's job is to
 * make the code big enough to read aloud and to say the things that are easy to
 * get wrong — how long it lives, and that issuing a second one kills the first.
 *
 * Since ADR-021 it is a setup token, not a one-shot. One slip links the phone,
 * the laptop AND LINE, for seven days and never past the end of the tenancy.
 * Under the old single-use rule, being set up on both app and LINE cost two
 * codes and two trips to the desk.
 *
 * Two independent states, deliberately not merged into one badge:
 *   * **เชื่อมแอปแล้ว** — a device holds a session. This is what lets someone
 *     see their bills.
 *   * **LINE: เชื่อมแล้ว** — a LINE account is bound, which only decides where
 *     the *copy* of a notification goes (rule 15). A tenant can have either
 *     without the other.
 *
 * They are read from two columns on `tenants` (migration 011). They used to be
 * derived from the code row, where a LINE bind and a re-issue both set the same
 * timestamp — so both badges lit up for a tenant who had never opened the app,
 * which is exactly the state the two badges exist to distinguish.
 */
const EXTEND_DAYS = 7;

function thaiDateTime(iso: string): string {
  return new Date(iso).toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function LinkCodeButton({ tenantId, tenantName }: { tenantId: string; tenantName?: string }) {
  const [status, setStatus] = useState<LinkStatus | null>(null);
  const [code, setCode] = useState<LinkCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchLinkStatus(tenantId)
      .then((r) => setStatus(r.status))
      .catch(() => setStatus(null));
  }, [tenantId]);

  /**
   * Every action re-reads rather than assuming: issuing revokes any outstanding
   * code and the expiry is capped at the contract end in the database, so the
   * screen must show what the database now says, not what we asked for.
   */
  async function run(action: () => Promise<LinkCode | null>, fallback: string) {
    setBusy(true);
    setError(null);
    try {
      setCode(await action());
      setStatus((await fetchLinkStatus(tenantId)).status);
    } catch (e) {
      setError(errorMessage(e, fallback));
    } finally {
      setBusy(false);
    }
  }

  const issue = () => run(async () => (await issueLinkCode(tenantId)).link_code, 'ออกรหัสไม่สำเร็จ');
  const extend = () =>
    run(async () => (await extendLinkCode(tenantId, EXTEND_DAYS)).link_code, 'ต่ออายุรหัสไม่สำเร็จ');
  const revoke = () =>
    run(async () => {
      await revokeLinkCode(tenantId);
      return null;
    }, 'ยกเลิกรหัสไม่สำเร็จ');

  const shown = code ?? null;
  const pending = status?.code_pending ?? false;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {status?.linked ? (
          <Badge tone="success">เชื่อมแอปแล้ว</Badge>
        ) : (
          <Badge tone="neutral">ยังไม่ได้เชื่อมแอป</Badge>
        )}
        {status?.line_linked ? (
          <Badge tone="success">LINE: เชื่อมแล้ว</Badge>
        ) : (
          <Badge tone="neutral">LINE: ยังไม่เชื่อม</Badge>
        )}
        <Button variant="ghost" onClick={issue} disabled={busy}>
          {busy ? 'กำลังดำเนินการ…' : pending || status?.linked ? 'ออกรหัสใหม่' : 'ออกรหัสเชื่อมบัญชี'}
        </Button>
        {pending && (
          <>
            <Button variant="ghost" onClick={extend} disabled={busy}>
              ต่ออายุ {EXTEND_DAYS} วัน
            </Button>
            <Button variant="ghost" onClick={revoke} disabled={busy}>
              ยกเลิกรหัส
            </Button>
          </>
        )}
      </div>

      {/* The live code's own state, whether or not it was issued in this session
          — staff often pick the screen up after someone else handed the slip
          over, and "is there a code out there" is the question they have. */}
      {pending && !shown && status?.code_expires_at && (
        <p className="text-xs text-text-muted">
          มีรหัสที่ยังใช้งานได้ · หมดอายุ {thaiDateTime(status.code_expires_at)} · เชื่อมแล้ว{' '}
          {status.code_redemptions} อุปกรณ์ — ออกรหัสใหม่จะทำให้รหัสเดิมใช้ไม่ได้
        </p>
      )}

      {error && <p className="text-xs text-danger">{error}</p>}

      {shown && (
        <div className="rounded border border-primary bg-[var(--primary-soft)] p-3">
          <p className="text-xs text-text-muted">
            อ่านรหัสนี้ให้{tenantName ? `คุณ${tenantName}` : 'ผู้เช่า'}กรอกในแอป หรือส่งในแชท LINE ของหอพัก
          </p>
          {/* Big and monospaced: it is read aloud across a desk, and O/I/S are
              not in the alphabet precisely because they are misheard. */}
          <p className="money my-1 text-3xl tracking-[0.3em]">{shown.code}</p>
          <p className="text-xs text-text-muted">
            ใช้ได้ทั้งแอปและ LINE · หมดอายุ {thaiDateTime(shown.expires_at)}
          </p>
        </div>
      )}
    </div>
  );
}
