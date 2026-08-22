'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { clearTenantSession, useTenantSession } from '@/lib/tenant-session';

/**
 * The tenant app's shell — phone-first, and deliberately not `AppShell`.
 *
 * AppShell is a 200px desktop sidebar built for a reception PC at 1366px. A
 * tenant is on a phone, so this is a single column capped at the prototype's
 * 390px frame, with the nav as a bottom bar. Touch targets are ≥44px and the
 * one primary action per screen is 52px (CLAUDE.md's phone-screen rules).
 *
 * No screen ID in the header: same owner decision as the staff pages
 * (2026-08-19) — the IDs stay in `/prototype/`, where they were a review aid.
 */
const NAV = [
  { href: '/t', label: 'หน้าหลัก' },
  { href: '/t/notifications', label: 'การแจ้งเตือน' },
];

export function TenantShell({
  title,
  children,
  back,
}: {
  title: string;
  children: React.ReactNode;
  /** A bill is reached from the home screen, so it gets a back arrow, not a tab. */
  back?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { tenant, loaded } = useTenantSession();

  // The redirect is a convenience, not a control: every /tenant/* call is
  // refused by Express without a valid tenant token regardless of what renders.
  useEffect(() => {
    if (loaded && !tenant) router.replace('/t/link');
  }, [loaded, tenant, router]);

  if (!loaded || !tenant) return null;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[430px] flex-col bg-surface">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-card px-4 py-3">
        {back && (
          <Link href={back} aria-label="ย้อนกลับ" className="-ml-2 flex h-11 w-11 items-center justify-center text-lg">
            ←
          </Link>
        )}
        <h1 className="text-base font-semibold">{title}</h1>
        <button
          type="button"
          onClick={() => {
            clearTenantSession();
            router.replace('/t/link');
          }}
          className="ml-auto min-h-[44px] px-2 text-xs text-text-muted"
        >
          ออกจากระบบ
        </button>
      </header>

      <main className="flex-1 px-4 py-4 pb-24">{children}</main>

      <nav className="fixed bottom-0 left-1/2 flex w-full max-w-[430px] -translate-x-1/2 border-t border-border bg-card">
        {NAV.map((n) => {
          const active = pathname === n.href;
          return (
            <Link
              key={n.href}
              href={n.href}
              className={`flex-1 py-4 text-center text-sm ${active ? 'font-semibold text-primary' : 'text-text-muted'}`}
            >
              {n.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
