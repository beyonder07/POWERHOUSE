import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'PowerHouse Gym',
  description: 'PowerHouse Gym - discipline, structure, and results.',
  icons: {
    icon: '/powerhouse-logo.jpg',
    shortcut: '/powerhouse-logo.jpg',
    apple: '/powerhouse-logo.jpg'
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="manifest" href="/manifest.webmanifest" />
      </head>
      <body>{children}</body>
    </html>
  );
}
