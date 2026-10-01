/*
 * Connection detector (ADR-0015, ось 2а): navigator.onLine is only a hint — the signal is whether
 * requests to apps/api go through. A network error or timeout switches to «offline», then
 * /api/v1/health is pinged until it answers. TanStack Query's onlineManager and the POS buffer
 * follow this state.
 */
const PING_INTERVAL_MS = 10_000;

type Listener = (online: boolean) => void;

let online = true;
let pingTimer: ReturnType<typeof setTimeout> | null = null;
let ping: (() => Promise<unknown>) | null = null;
const listeners = new Set<Listener>();

function set(next: boolean): void {
  if (online === next) return;
  online = next;
  if (online) stopPinging();
  else schedulePing();
  listeners.forEach((listener) => listener(online));
}

function stopPinging(): void {
  if (pingTimer) clearTimeout(pingTimer);
  pingTimer = null;
}

function schedulePing(): void {
  stopPinging();
  if (!ping) return;
  const run = ping;
  pingTimer = setTimeout(() => {
    run().then(
      () => set(true),
      () => schedulePing(),
    );
  }, PING_INTERVAL_MS);
}

export function isOnline(): boolean {
  return online;
}

export function subscribeConnectivity(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Called by the API client after every request. */
export function reportRequest(reached: boolean): void {
  set(reached);
}

/** Wires the health ping and the browser hints; returns a cleanup. */
export function startConnectivity(
  healthPing: () => Promise<unknown>,
): () => void {
  ping = healthPing;
  const offline = () => set(false);
  const onlineHint = () => {
    healthPing().then(
      () => set(true),
      () => set(false),
    );
  };
  window.addEventListener('offline', offline);
  window.addEventListener('online', onlineHint);
  if (!navigator.onLine) set(false);
  return () => {
    window.removeEventListener('offline', offline);
    window.removeEventListener('online', onlineHint);
    stopPinging();
    ping = null;
  };
}

/** Tests only. */
export function resetConnectivity(): void {
  stopPinging();
  online = true;
  listeners.clear();
}
