import { openPosDb, type OutboxRecord, type PosDb } from './db';
import { backoffDelay, OfflineQueue, type Sender } from './queue';

let dbIndex = 0;
let db: PosDb;

beforeEach(async () => {
  dbIndex += 1;
  db = await openPosDb(`queue-test-${dbIndex}`);
});
afterEach(() => db.close());

const record = (id: string, createdAt: string) => ({
  id,
  kind: 'receipt',
  payload: { id },
  createdAt,
});

function failure(status: number, code: string) {
  return Object.assign(new Error(code), { status, code, correlationId: 'c' });
}

function queueWith(send: Sender, now = () => 1_000) {
  return new OfflineQueue(db, `lock-${dbIndex}`, send, now);
}

describe('OfflineQueue', () => {
  it('sends operations one by one in FIFO order and removes delivered ones', async () => {
    const sent: string[] = [];
    const queue = queueWith(async (r) => {
      sent.push(r.id);
      return { ok: r.id };
    });
    const delivered: string[] = [];
    queue.onDelivered((r) => delivered.push(r.id));
    // written out of order (e.g. restored after a reload): sent by creation time
    for (const [id, createdAt] of [
      ['b', '2026-10-01T10:00:01Z'],
      ['a', '2026-10-01T10:00:00Z'],
    ]) {
      await db.put('outbox', {
        ...record(id, createdAt),
        attempts: 0,
        status: 'pending',
        nextAttemptAt: 0,
        lastError: null,
      });
    }
    await queue.flush();
    expect(sent).toEqual(['a', 'b']);
    expect(delivered).toHaveLength(2);
    expect(await db.count('outbox')).toBe(0);
    expect(queue.getCounts()).toMatchObject({ pending: 0, quarantine: 0 });
  });

  it('keeps an operation on a network error and nothing overtakes it', async () => {
    let online = false;
    const sent: string[] = [];
    const queue = queueWith(async (r) => {
      if (!online) throw failure(0, 'network');
      sent.push(r.id);
    });
    await queue.enqueue(record('first', '2026-10-01T10:00:00Z'));
    await queue.enqueue(record('second', '2026-10-01T10:00:01Z'));
    await queue.flush();
    const [first] = (await queue.list()) as OutboxRecord[];
    expect(first).toMatchObject({
      id: 'first',
      attempts: 1,
      status: 'pending',
    });
    expect(first.nextAttemptAt).toBeGreaterThan(1_000);
    expect(queue.getCounts().pending).toBe(2);
    expect(sent).toEqual([]);

    online = true;
    await db.put('outbox', { ...first, nextAttemptAt: 0 });
    await queue.flush();
    expect(sent).toEqual(['first', 'second']);
    queue.stop();
  });

  it('puts refused operations into quarantine and goes on with the next', async () => {
    const queue = queueWith(async (r) => {
      if (r.id === 'bad') throw failure(409, 'idempotency_conflict');
    });
    await queue.enqueue(record('bad', '2026-10-01T10:00:00Z'));
    await queue.enqueue(record('good', '2026-10-01T10:00:01Z'));
    await queue.flush();
    const left = await queue.list();
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({
      id: 'bad',
      status: 'quarantine',
      lastError: { status: 409, code: 'idempotency_conflict' },
    });
    expect(queue.getCounts()).toMatchObject({ pending: 0, quarantine: 1 });
  });

  it('retries a quarantined operation with the same key', async () => {
    let refuse = true;
    const keys: string[] = [];
    const queue = queueWith(async (r) => {
      keys.push(r.id);
      if (refuse) throw failure(422, 'validation_failed');
    });
    await queue.enqueue(record('op', '2026-10-01T10:00:00Z'));
    await queue.flush();
    refuse = false;
    await queue.retry('op');
    await queue.flush();
    expect(keys).toEqual(['op', 'op']);
    expect(await db.count('outbox')).toBe(0);
  });

  it('pauses on 401/403 without losing the operation', async () => {
    const queue = queueWith(async () => {
      throw failure(401, 'unauthenticated');
    });
    await queue.enqueue(record('op', '2026-10-01T10:00:00Z'));
    await queue.flush();
    expect(queue.getCounts()).toMatchObject({ pending: 1, paused: true });
    expect(await db.count('outbox')).toBe(1);
  });

  it('survives a reload: a new queue on the same database sees the operations', async () => {
    const offline = queueWith(async () => {
      throw failure(0, 'network');
    });
    await offline.enqueue(record('op', '2026-10-01T10:00:00Z'));
    offline.stop();
    const reloaded = queueWith(async () => undefined);
    await reloaded.refreshCounts();
    expect(reloaded.getCounts().pending).toBe(1);
  });
});

describe('backoffDelay', () => {
  it('grows exponentially with jitter and stays under 60 s', () => {
    expect(backoffDelay(1, () => 0)).toBe(1_000);
    expect(backoffDelay(1, () => 1)).toBe(2_000);
    expect(backoffDelay(3, () => 0.5)).toBe(6_000);
    expect(backoffDelay(20, () => 1)).toBe(60_000);
  });
});
