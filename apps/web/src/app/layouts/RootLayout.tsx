import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AppProviders } from '../bootstrap/AppProviders';
import '../styles/global.css';

export const metadata: Metadata = {
  title: 'Дорухона',
};

/** Touch density always (no data-density): screens from 10″, targets ≥ 44 px. */
export function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
