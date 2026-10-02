/*
 * A POS terminal reopens during an outage (ADR-0015, ось 3): the last terminal session and shift
 * are kept in IndexedDB; an answer of the server (401) or sign-out forgets them; an office session
 * without a terminal is never kept.
 */
import { fetchSession } from '@/entities/session';
import {
  rememberedSession,
  rememberedShift,
  rememberShift,
} from '@/shared/lib/terminal-cache';
import {
  mockApi,
  scenario,
  signInAs,
  signInByPin,
  useMockApi,
} from './mock-env';

useMockApi();

describe('terminal cache', () => {
  it('reopens a terminal session during an outage, without the phone', async () => {
    await signInByPin('emp-cashier', '2580');
    const online = await fetchSession();
    await scenario('offline');
    const offline = await fetchSession();
    expect(offline?.employee.id).toBe(online?.employee.id);
    expect(offline?.terminalId).toBe('term-3-1');
    expect(offline?.employee.phone).toBe('');
  });

  it('forgets the session on 401 and never keeps an office session', async () => {
    await signInByPin('emp-cashier', '2580');
    await fetchSession();
    await mockApi()('sessions.delete', {}, 'test');
    expect(await fetchSession()).toBeNull();
    expect(await rememberedSession()).toBeUndefined();

    await signInAs('firuz', 'store-1');
    await fetchSession();
    expect(await rememberedSession()).toBeUndefined();
    await scenario('offline');
    await expect(fetchSession()).rejects.toMatchObject({ code: 'network' });
  });

  it('keeps the last shift of the store, including «no shift»', async () => {
    await rememberShift('store-3', null);
    expect(await rememberedShift('store-3')).toBeNull();
    expect(await rememberedShift('store-1')).toBeUndefined();
  });
});
