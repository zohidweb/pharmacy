'use client';

/*
 * Registration of the Service Worker (ADR-0015, ось 6б): production build only, cloud deployment
 * only (the offline store serves the API on localhost and needs no worker). A waiting new version
 * is activated only while the POS receipt is empty — never in the middle of a sale; the page reloads
 * onto it the same way, also when the activation came late and found a receipt in progress.
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
    let deferred: ReturnType<typeof setInterval> | null = null;
    const reloadWhenIdle = () => {
      if (reloaded || usePosStore.getState().draft.lines.length > 0) return;
      reloaded = true;
      window.location.reload();
    };
    const onController = () => {
      reloadWhenIdle();
      // Chrome may put the activation off (~30 s, until the old worker is idle again) and a sale may
      // have started meanwhile: the page reloads at the first check that finds the receipt empty. A
      // check, not the moment the receipt empties: payment empties it before its last steps are done
      if (!reloaded) deferred ??= setInterval(reloadWhenIdle, CHECK_MS);
    };
    navigator.serviceWorker.addEventListener('controllerchange', onController);
    return () => {
      cancelled = true;
      stop?.();
      if (deferred) clearInterval(deferred);
      navigator.serviceWorker.removeEventListener(
        'controllerchange',
        onController,
      );
    };
  }, []);
  return null;
}
