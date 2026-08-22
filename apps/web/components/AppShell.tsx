'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { clearSession, useSession } from '@/lib/session';

/**
 * The desktop shell: sidebar + topbar, matching the prototype's nav.js.
 *
 * The screen ID is NOT rendered (owner, 2026-08-19). "S03 · ผังห้อง" in the
 * header was a prototype-review convenience so the owner could name a screen in
 * feedback; this is the real system, and staff have no use for it. Every page
 * still passes `screen` — it stays in the props as the link back to the
 * prototype file and to the Master Document's §10 inventory.
 */
const NAV = [
  { href: '/dashboard', label: 'หน้าหลัก', screen: 'S02' },
  { href: '/today', label: 'งานวันนี้', screen: 'S28' },
  { href: '/rooms', label: 'ผังห้อง', screen: 'S03' },
  { href: '/meters', label: 'จดมิเตอร์', screen: 'S13' },
  { href: '/invoices', label: 'รายการบิล', screen: 'S18' },
  // ADR-007: verification is the owner's, so the nav item is too. Hiding it is
  // a convenience, never the control — Express refuses a staff token anyway.
  { href: '/verify', label: 'รอตรวจสอบ', screen: 'S21', adminOnly: true },
  { href: '/requests', label: 'เรื่องแจ้ง', screen: 'S42' },
  { href: '/announcements', label: 'ประกาศ', screen: 'S41' },
  { href: '/reports', label: 'รายงานรายรับ', screen: 'S39', adminOnly: true },
  { href: '/tenants', label: 'ทะเบียนผู้เช่า', screen: 'S44' },
  { href: '/settings', label: 'ตั้งค่าระบบ', screen: 'S43' },
  { href: '/staff', label: 'ผู้ใช้และสิทธิ์', screen: 'S26', adminOnly: true },
  { href: '/audit', label: 'ประวัติการใช้งาน', screen: 'S45', adminOnly: true },
];

export function AppShell({
  title,
  children,
}: {
  /** Kept in the contract, deliberately not rendered — see the note above. */
  screen: string;
  title: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loaded } = useSession();

  useEffect(() => {
    if (loaded && !user) router.replace('/login');
  }, [loaded, user, router]);

  if (!loaded || !user) return null;

  function signOut() {
    clearSession();
    router.replace('/login');
  }

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-[200px] shrink-0 flex-col gap-1 border-r border-chrome-border bg-chrome p-3">
        <div className="mb-3 flex items-center gap-[10px] px-1">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] bg-primary font-heading font-bold text-primary-contrast">
            A
          </span>
          <span className="font-heading font-semibold">อมาเนว์</span>
        </div>

        {NAV.filter((item) => !item.adminOnly || user.role === 'admin').map((item) => {
          // A section is active when the path is inside it, not only when it
          // matches exactly — /invoices/123 still belongs to รายการบิล.
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded px-3 py-2 ${
                active ? 'bg-chrome-active-bg font-semibold text-chrome-active-text' : 'text-chrome-text'
              }`}
            >
              {item.label}
            </Link>
          );
        })}

        <div className="mt-auto flex flex-col gap-1 border-t border-chrome-border pt-3 text-xs text-chrome-muted">
          <span>{user.name}</span>
          <span>
            {user.role === 'admin' ? 'เจ้าของ' : user.role === 'staff' ? 'พนักงาน' : 'ฝ่ายซ่อมบำรุง'}
          </span>
          <button type="button" onClick={signOut} className="mt-1 self-start text-danger">
            ออกจากระบบ
          </button>
        </div>
      </aside>

      <main className="flex-1 bg-surface p-5">
        <div className="mb-4 flex items-baseline gap-3">
          <h1 className="text-[19px]">{title}</h1>
        </div>
        {children}
      </main>
    </div>
  );
}
