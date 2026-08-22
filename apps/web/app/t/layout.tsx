import type { Metadata } from 'next';

/**
 * Metadata for the tenant app only. The `/t` screens are all client components,
 * so this layout exists to carry what only a server component may export.
 *
 * `appleWebApp` is the iOS half of the manifest: Safari ignores `display:
 * standalone` and needs its own tags before an added-to-home-screen icon opens
 * without the browser chrome. It is scoped here rather than in the root layout
 * because reception's desktop has no use for it.
 */
export const metadata: Metadata = {
  title: 'อมาใหม่ เรสซิเดนซ์',
  description: 'ดูบิลค่าเช่า ค่าน้ำค่าไฟ และแจ้งชำระเงิน',
  appleWebApp: { capable: true, title: 'อมาใหม่', statusBarStyle: 'default' },
  icons: { apple: '/apple-touch-icon.png' },
};

export default function TenantLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
