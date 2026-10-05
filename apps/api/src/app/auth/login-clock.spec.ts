import { SystemLoginClock } from './login-clock';

// The real clock behind the login failure floor: monotonic time, a timer-based sleep and an
// integer jitter in [0, max].

describe('SystemLoginClock', () => {
  const clock = new SystemLoginClock();

  it('keeps jitter an integer within [0, max]', () => {
    for (let i = 0; i < 200; i++) {
      const jitter = clock.jitterMs(50);
      expect(Number.isInteger(jitter)).toBe(true);
      expect(jitter).toBeGreaterThanOrEqual(0);
      expect(jitter).toBeLessThanOrEqual(50);
    }
    expect(clock.jitterMs(0)).toBe(0);
  });

  it('sleeps at least the given time on a monotonic clock', async () => {
    const start = clock.now();
    await clock.sleep(20);
    expect(clock.now() - start).toBeGreaterThanOrEqual(19);
  });
});
