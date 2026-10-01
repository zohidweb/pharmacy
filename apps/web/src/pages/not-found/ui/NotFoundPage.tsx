'use client';

import { StateScreen } from '@/shared/ui';

/** 404 of the static export (app/not-found.tsx). */
export function NotFoundPage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-bg">
      <StateScreen kind="notFound" />
    </main>
  );
}
