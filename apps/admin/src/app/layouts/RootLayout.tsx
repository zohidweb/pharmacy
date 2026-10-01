import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AppProviders } from '../bootstrap/AppProviders';
import '../styles/global.css';

export const metadata: Metadata = {
  title: 'Platform Admin',
};

export function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru" data-density="compact">
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
