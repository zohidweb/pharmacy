'use client';

/*
 * Registration of the Service Worker (ADR-0015, ось 6б): production build only, cloud deployment
 * only (the offline store serves the API on localhost and needs no worker). A waiting new version
 * is activated only while the POS receipt is empty — never in the middle of a sale.
 */
import { useEffect } from 'react';
import { usePosStore } from '@/features/pos';
import { apiRequest } from '@/shared/api';

const CHECK_MS = 30_000;

function activateWhenIdle(registration: ServiceWorkerRegistration): () => void {
  const timer = setInterval(() => {
    const waiting = registration.waiting;
    if (!waiting) return;
    if (usePosStore.getState().draft.lines.length > 0) return;
    waiting.postMessage({ type: 'SKIP_WAITING' });
  }, CHECK_MS);
  return () => clearInterval(timer);
}

export function ServiceWorker() {
  useEffect(() => {
    if (
      process.env.NODE_ENV !== 'production' ||
      !('serviceWorker' in navigator)
    ) {
      return;
    }
    let stop: (() => void) | null = null;
    let cancelled = false;
    apiRequest('deployment.get')
      .then((deployment) => {
        if (cancelled || deployment.kind !== 'cloud') return;
        return navigator.serviceWorker
          .register('/sw.js')
          .then((registration) => {
            if (!cancelled) stop = activateWhenIdle(registration);
          });
      })
      // no worker is not an error: the app works online without it
      .catch(() => undefined);
    let reloaded = false;
    const onController = () => {
      if (reloaded || usePosStore.getState().draft.lines.length > 0) return;
      reloaded = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onController);
    return () => {
      cancelled = true;
      stop?.();
      navigator.serviceWorker.removeEventListener(
        'controllerchange',
        onController,
      );
    };
  }, []);
  return null;
}
