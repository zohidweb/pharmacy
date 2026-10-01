import {
  ApiError,
  apiRequest,
  setApiTransport,
  type ApiTransport,
} from './client';
import {
  isOnline,
  resetConnectivity,
  startConnectivity,
  subscribeConnectivity,
} from './connectivity';

function transportFailing(code: string, status = 0): ApiTransport {
  return async (_route, _options, correlationId) => {
    throw new ApiError(status, code, correlationId);
  };
}

const ok: ApiTransport = async () => ({ status: 'ok' }) as never;

beforeEach(() => resetConnectivity());

describe('connection detector', () => {
  it('goes offline on a network error and back online on any answer', async () => {
    const changes: boolean[] = [];
    subscribeConnectivity((online) => changes.push(online));
    setApiTransport(transportFailing('network'));
    await expect(apiRequest('health.get')).rejects.toThrow();
    expect(isOnline()).toBe(false);
    // a 404 is an answer of the server: it is reachable
    setApiTransport(transportFailing('not_found', 404));
    await expect(apiRequest('health.get')).rejects.toThrow();
    expect(isOnline()).toBe(true);
    expect(changes).toEqual([false, true]);
  });

  it('does not treat a cancelled request as an outage', async () => {
    setApiTransport(transportFailing('aborted'));
    await expect(apiRequest('health.get')).rejects.toThrow();
    expect(isOnline()).toBe(true);
  });

  it('pings the API while offline until it answers', async () => {
    jest.useFakeTimers();
    let reachable = false;
    const ping = jest.fn(async () => {
      if (!reachable) throw new Error('down');
    });
    const stop = startConnectivity(ping);
    setApiTransport(transportFailing('timeout'));
    await expect(apiRequest('health.get')).rejects.toThrow();
    expect(isOnline()).toBe(false);
    await jest.advanceTimersByTimeAsync(10_000);
    expect(ping).toHaveBeenCalledTimes(1);
    expect(isOnline()).toBe(false);
    reachable = true;
    await jest.advanceTimersByTimeAsync(10_000);
    expect(isOnline()).toBe(true);
    stop();
    setApiTransport(ok);
    jest.useRealTimers();
  });
});
