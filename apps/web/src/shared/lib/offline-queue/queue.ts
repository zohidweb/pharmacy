/*
 * Outbox of a POS terminal (ADR-0015, «Буфер кассы»): every buffered operation is first written to
 * IndexedDB (in one transaction with the change of the draft), then sent. One sender per terminal
 * (Web Locks), strictly one by one in FIFO order, with exponential backoff and jitter up to 60 s.
 * 2xx — delivered and removed; network, timeout, 5xx — retried later; 401/403 — paused until the
 * session is back; 409 and other 4xx — quarantine: kept for the manager, never removed silently and
 * the key is never regenerated.
 */
import type {
  OutboxError,
  OutboxRecord,
  PosDb,
  PosWriteTransaction,
} from './db';

const MAX_DELAY_MS = 60_000;
const BASE_DELAY_MS = 1_000;

export interface SendError {
  status: number;
  code: string;
  correlationId: string;
}

export type Sender = (record: OutboxRecord) => Promise<unknown>;

export interface OutboxCounts {
  pending: number;
  quarantine: number;
  /** The sender is waiting for the session (401/403). */
  paused: boolean;
}

type DeliveredListener = (record: OutboxRecord, response: unknown) => void;

export function backoffDelay(attempts: number, random = Math.random): number {
  const ceiling = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempts);
  // equal jitter: half fixed, half random — 30 stores do not come back all at once
  return Math.round(ceiling / 2 + (random() * ceiling) / 2);
}

function asSendError(error: unknown): SendError {
  if (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    'code' in error
  ) {
    const e = error as { status: number; code: string; correlationId?: string };
    return {
      status: e.status,
      code: e.code,
      correlationId: e.correlationId ?? '—',
    };
  }
  return { status: 0, code: 'unexpected', correlationId: '—' };
}

type Outcome = 'delivered' | 'retry' | 'pause' | 'quarantine';

function classify(error: SendError): Outcome {
  if (error.status === 0 || error.status >= 500 || error.status === 429) {
    return 'retry';
  }
  if (error.status === 401 || error.status === 403) return 'pause';
  return 'quarantine';
}

export class OfflineQueue {
  private counts: OutboxCounts = { pending: 0, quarantine: 0, paused: false };
  private readonly listeners = new Set<(counts: OutboxCounts) => void>();
  private readonly delivered = new Set<DeliveredListener>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private stopped = false;

  constructor(
    private readonly db: PosDb,
    private readonly lockName: string,
    private readonly send: Sender,
    private readonly now: () => number = Date.now,
  ) {}

  /** Writes the operation (and optional extra writes) in one transaction, then starts sending. */
  async enqueue(
    record: Omit<
      OutboxRecord,
      'attempts' | 'status' | 'nextAttemptAt' | 'lastError'
    >,
    alsoInTransaction?: (tx: PosWriteTransaction) => Promise<void>,
  ): Promise<void> {
    const tx = this.db.transaction(['outbox', 'state'], 'readwrite');
    await tx.objectStore('outbox').put({
      ...record,
      attempts: 0,
      status: 'pending',
      nextAttemptAt: 0,
      lastError: null,
    });
    if (alsoInTransaction) await alsoInTransaction(tx);
    await tx.done;
    await this.refreshCounts();
    void this.flush();
  }

  getCounts(): OutboxCounts {
    return this.counts;
  }

  subscribe(listener: (counts: OutboxCounts) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onDelivered(listener: DeliveredListener): () => void {
    this.delivered.add(listener);
    return () => this.delivered.delete(listener);
  }

  async list(): Promise<OutboxRecord[]> {
    return this.db.getAllFromIndex('outbox', 'byCreatedAt');
  }

  /** Back to the queue with the same key (the manager fixed the cause). */
  async retry(id: string): Promise<void> {
    const record = await this.db.get('outbox', id);
    if (!record) return;
    await this.db.put('outbox', {
      ...record,
      status: 'pending',
      attempts: 0,
      nextAttemptAt: 0,
    });
    await this.refreshCounts();
    void this.flush();
  }

  /** Session restored or connection back: try again now. */
  resume(): void {
    this.counts = { ...this.counts, paused: false };
    this.emit();
    void this.flush();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Sends due operations one by one; a single run at a time per terminal. */
  flush(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.running) return this.running;
    const run = () => this.drain();
    const locks =
      typeof navigator !== 'undefined' ? navigator.locks : undefined;
    this.running = (locks ? locks.request(this.lockName, run) : run()).finally(
      () => {
        this.running = null;
      },
    );
    return this.running;
  }

  private async drain(): Promise<void> {
    if (this.counts.paused) return;
    for (;;) {
      const next = (await this.list()).find((r) => r.status === 'pending');
      if (!next || this.stopped) break;
      const wait = next.nextAttemptAt - this.now();
      if (wait > 0) {
        this.schedule(wait);
        break;
      }
      try {
        const response = await this.send(next);
        await this.db.delete('outbox', next.id);
        this.delivered.forEach((listener) => listener(next, response));
      } catch (raw) {
        const error = asSendError(raw);
        const outcome = classify(error);
        const lastError: OutboxError = error;
        if (outcome === 'retry') {
          const attempts = next.attempts + 1;
          const delay = backoffDelay(attempts);
          await this.db.put('outbox', {
            ...next,
            attempts,
            lastError,
            nextAttemptAt: this.now() + delay,
          });
          await this.refreshCounts();
          this.schedule(delay);
          break; // FIFO: nothing overtakes the operation that waits
        }
        if (outcome === 'pause') {
          await this.db.put('outbox', { ...next, lastError });
          this.counts = { ...this.counts, paused: true };
          this.emit();
          break;
        }
        await this.db.put('outbox', {
          ...next,
          status: 'quarantine',
          lastError,
        });
      }
      await this.refreshCounts();
    }
    await this.refreshCounts();
  }

  private schedule(delay: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, delay);
  }

  async refreshCounts(): Promise<void> {
    const all = await this.db.getAll('outbox');
    const pending = all.filter((r) => r.status === 'pending').length;
    const quarantine = all.length - pending;
    if (
      pending === this.counts.pending &&
      quarantine === this.counts.quarantine
    ) {
      return;
    }
    this.counts = { ...this.counts, pending, quarantine };
    this.emit();
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener(this.counts));
  }
}
