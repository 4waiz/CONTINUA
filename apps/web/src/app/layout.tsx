import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CONTINUA - Predictive Network Continuity',
  description:
    'CONTINUA by Team Kanban. An emergency-response inspection rover travels from a wired dock through Wi-Fi and cellular coverage into a satellite-served remote sector. The network changes. The session doesn’t.',
  applicationName: 'CONTINUA',
  authors: [{ name: 'Team Kanban' }],
  openGraph: {
    title: 'CONTINUA - Predictive Network Continuity',
    description: 'The network changes. The session doesn’t.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  themeColor: '#F7FAFF',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
