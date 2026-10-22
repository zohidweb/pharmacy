/*
 * The limits of the outage buffer as the cashier meets them (spec 2026-10-21-pos-offline-limits, P6–P8, P17;
 * ADR-0015): from 80 % of a limit a warning, at the limit a block — the general one stops new receipts, the ПКУ one
 * stops ПКУ; a sign-in of the cashier older than the general limit in hours stops every operation of the buffer,
 * which the server would not take (P10). The limits come with the catalog snapshot and stay for an outage.
 */
import {
  BUFFER_WARN_RATIO,
  type PosBufferLimits,
  posBufferDefaults,
} from '@pharmacy/shared-domain';
import type { PosDb } from './db';
import type { OutboxCounts } from './queue';

export type BufferLevel = 'ok' | 'warn' | 'blocked';

export interface BufferState {
  general: BufferLevel;
  controlled: BufferLevel;
  signIn: 'ok' | 'blocked';
  pending: number;
  /** Age of the oldest waiting operation, whole hours. */
  oldestHours: number;
  controlledPending: number;
  limits: PosBufferLimits;
}

const HOUR_MS = 3_600_000;
const LIMITS_KEY = 'buffer-limits';

const msSince = (iso: string | null, now: number): number =>
  iso === null ? 0 : Math.max(0, now - Date.parse(iso));

// whole operations and milliseconds: 24 h × 0.8 is not 19.2 h in floating point
function level(
  count: number,
  maxCount: number,
  ageMs: number,
  maxHours: number,
): BufferLevel {
  const maxMs = maxHours * HOUR_MS;
  if (count >= maxCount || (count > 0 && ageMs >= maxMs)) return 'blocked';
  if (
    count >= Math.round(maxCount * BUFFER_WARN_RATIO) ||
    (count > 0 && ageMs >= Math.round(maxMs * BUFFER_WARN_RATIO))
  ) {
    return 'warn';
  }
  return 'ok';
}

export function bufferState(
  counts: OutboxCounts,
  limits: PosBufferLimits,
  now: number,
  signedInAt: string | null,
): BufferState {
  const oldestMs = msSince(counts.oldestPendingAt, now);
  return {
    general: level(
      counts.pending,
      limits.maxOperations,
      oldestMs,
      limits.maxHours,
    ),
    controlled: level(
      counts.controlledPending,
      limits.controlledMaxOperations,
      msSince(counts.oldestControlledAt, now),
      limits.controlledMaxHours,
    ),
    signIn:
      signedInAt !== null &&
      msSince(signedInAt, now) >= limits.maxHours * HOUR_MS
        ? 'blocked'
        : 'ok',
    pending: counts.pending,
    oldestHours: Math.floor(oldestMs / HOUR_MS),
    controlledPending: counts.controlledPending,
    limits,
  };
}

function isLimits(value: unknown): value is PosBufferLimits {
  if (typeof value !== 'object' || value === null) return false;
  const limits = value as Record<string, unknown>;
  return (
    [
      'maxHours',
      'maxOperations',
      'controlledMaxHours',
      'controlledMaxOperations',
    ] as const
  ).every((key) => typeof limits[key] === 'number' && limits[key] > 0);
}

/** The limits of the last catalog snapshot; the defaults before the first one (or from an older snapshot). */
export async function readBufferLimits(db: PosDb): Promise<PosBufferLimits> {
  try {
    const stored = await db.get('state', LIMITS_KEY);
    return isLimits(stored) ? stored : posBufferDefaults;
  } catch {
    return posBufferDefaults;
  }
}

export function storeBufferLimits(
  db: PosDb,
  limits: PosBufferLimits | undefined,
): Promise<unknown> {
  return isLimits(limits)
    ? db.put('state', limits, LIMITS_KEY)
    : Promise.resolve();
}
