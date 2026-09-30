import type { Metadata } from 'next';
import '../styles/global.css';

export const metadata: Metadata = {
  title: 'Pharmacy — операторы',
};

export function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" data-density="compact">
      <body>{children}</body>
    </html>
  );
}
