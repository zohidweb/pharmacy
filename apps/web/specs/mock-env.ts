/*
 * Shared setup of the screen tests: the in-memory API mocks, a fresh data set and session per test,
 * and helpers that sign in through the mock API the way the sign-in screen does.
 */
import { IDBFactory } from 'fake-indexeddb';
import { emptyDraft, usePosStore } from '@/features/pos';
import {
  applyMockScenario,
  resetConnectivity,
  loadMockTransport,
  resetApiMocks,
  setApiTransport,
  type ApiTransport,
  type MockScenario,
} from '@/shared/api';
import { resetTerminalRuntimes } from '@/shared/lib/offline-queue';
import { resetTerminalCache } from '@/shared/lib/terminal-cache';
import { useShellChrome } from '@/shared/lib/shell-chrome';

export const MOCK_PASSWORD = 'Demo1234';

let transport: ApiTransport;

export function useMockApi() {
  beforeAll(async () => {
    transport = await loadMockTransport();
  });
  beforeEach(async () => {
    setApiTransport(transport);
    await resetApiMocks();
    sessionStorage.clear();
    localStorage.clear();
    // a fresh terminal: no IndexedDB, no outbox sender, no draft, connection up
    await resetTerminalRuntimes();
    globalThis.indexedDB = new IDBFactory();
    resetTerminalCache();
    resetConnectivity();
    usePosStore.setState({
      draft: emptyDraft(),
      hydrated: false,
      notice: null,
    });
    useShellChrome.setState({ fullscreen: false });
  });
  afterEach(async () => {
    await resetTerminalRuntimes();
  });
}

export function mockApi(): ApiTransport {
  return transport;
}

/** Password sign-in, then the working store when the employee has to choose one. */
export async function signInAs(login: string, storeId = 'store-3') {
  const session = await transport(
    'sessions.create',
    { body: { login, password: MOCK_PASSWORD } },
    'test',
  );
  if (!session.currentStoreId) {
    await transport('sessions.selectStore', { body: { storeId } }, 'test');
  }
}

export async function signInByPin(employeeId: string, pin: string) {
  await transport(
    'terminalSessions.create',
    { body: { employeeId, pin } },
    'test',
  );
}

export const scenario = (name: MockScenario) => applyMockScenario(name);
