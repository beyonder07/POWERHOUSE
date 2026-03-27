import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'PowerHouse Gym Console',
  description: 'PowerHouse local-first gym management system',
  icons: {
    icon: '/powerhouse-logo.jpg',
    shortcut: '/powerhouse-logo.jpg',
    apple: '/powerhouse-logo.jpg'
  }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}

