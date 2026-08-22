'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiFetch, ApiError } from '@/lib/api';
import { setSession, type Role } from '@/lib/session';

type LoginResponse = { token: string; user: { id: string; name: string; role: string } };

export default function LoginPage() {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<LoginResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ phone, password }),
      });
      // Shift-length session on a shared reception desk (JWT_EXPIRES_IN=10h).
      setSession(res.token, { ...res.user, role: res.user.role as Role });
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'เชื่อมต่อระบบไม่ได้');
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface p-4">
      <div className="flex w-full max-w-[380px] flex-col gap-[18px]">
        <div className="flex items-center justify-center gap-[10px]">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] bg-primary font-heading font-bold text-primary-contrast">
            A
          </span>
          <h1 className="text-[19px]">อมาเนว์ เรสซิเดนซ์</h1>
        </div>

        <div className="flex flex-col gap-[14px] rounded border border-border bg-card p-4">
          <form onSubmit={onSubmit} className="flex flex-col gap-[14px]">
            <div className="flex flex-col gap-1">
              {/* Phone is the universal identifier — there is no email field. */}
              <label htmlFor="phone" className="text-text-muted">
                เบอร์โทรศัพท์ <span className="text-danger">*</span>
              </label>
              <input
                id="phone"
                type="tel"
                required
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="rounded border border-border px-3 py-2 outline-none focus:border-primary"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="password" className="text-text-muted">
                รหัสผ่าน <span className="text-danger">*</span>
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="rounded border border-border px-3 py-2 outline-none focus:border-primary"
              />
              {error && <div className="text-danger">{error}</div>}
            </div>

            <button
              type="submit"
              disabled={busy}
              className="rounded-btn bg-primary px-4 py-2 font-medium text-primary-contrast disabled:opacity-60"
            >
              {busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
