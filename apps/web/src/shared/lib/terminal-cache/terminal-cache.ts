/*
 * What a POS terminal needs to reopen during an outage (ADR-0015, ось 3): the last profile of the
 * terminal session and the open shift of its store. Kept in IndexedDB of the browser (idb), only
 * for sessions bound to a terminal; the profile carries no secrets (the session itself is the
 * httpOnly cookie) and the employee's phone is dropped. Reads and writes never throw: without
 * storage the POS simply needs the network to reopen, as before.
 */
import type { EmployeeSession, Shift } from '@pharmacy/shared-dto';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

interface TerminalCacheSchema extends DBSchema {
  cache: { key: string; value: unknown };
}

const DB_NAME = 'pharmacy-terminal';
const SESSION_KEY = 'session';
const shiftKey = (storeId: string) => `shift:${storeId}`;

let opening: Promise<IDBPDatabase<TerminalCacheSchema>> | null = null;

function db() {
  opening ??= openDB<TerminalCacheSchema>(DB_NAME, 1, {
    upgrade(database) {
      database.createObjectStore('cache');
    },
  });
  return opening;
}

async function read<T>(key: string): Promise<T | undefined> {
  try {
    return (await (await db()).get('cache', key)) as T | undefined;
  } catch {
    return undefined;
  }
}

async function write(key: string, value: unknown | undefined) {
  try {
    const database = await db();
    if (value === undefined) await database.delete('cache', key);
    else await database.put('cache', value, key);
  } catch {
    // storage unavailable: the POS needs the network to reopen
  }
}

/** Remembers a terminal session; any other session is forgotten (an office PC keeps nothing). */
export function rememberSession(session: EmployeeSession | null) {
  if (!session?.terminalId) return write(SESSION_KEY, undefined);
  return write(SESSION_KEY, {
    ...session,
    employee: { ...session.employee, phone: '' },
  });
}

export const rememberedSession = () => read<EmployeeSession>(SESSION_KEY);

/** null — the store has no open shift (as the server said last time). */
export const rememberShift = (storeId: string, shift: Shift | null) =>
  write(shiftKey(storeId), shift);

export const rememberedShift = (storeId: string) =>
  read<Shift | null>(shiftKey(storeId));

/** Sign-out and an expired session: nothing of the employee stays on the terminal. */
export async function forgetTerminal() {
  try {
    await (await db()).clear('cache');
  } catch {
    // nothing to forget
  }
}

/** Tests: drop the open connection so a fresh IndexedDB factory can be used. */
export function resetTerminalCache() {
  opening = null;
}
