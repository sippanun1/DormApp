import type { Metadata } from 'next';
import { IBM_Plex_Sans_Thai } from 'next/font/google';
import './globals.css';

// Style A's typeface. Self-hosted by next/font — no CDN request at runtime,
// which the prototype could not avoid but a real deployment should.
const ibmPlexThai = IBM_Plex_Sans_Thai({
  subsets: ['thai', 'latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-ibm-plex-thai',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Amanew Residence',
  description: 'ระบบจัดการหอพัก อมาใหม่ เรสซิเดนซ์',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className={ibmPlexThai.variable}>
      <body>{children}</body>
    </html>
  );
}
