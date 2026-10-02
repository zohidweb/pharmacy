import { testRedisUrl } from './redis';

describe('testRedisUrl', () => {
  it('switches the logical database to 15 and keeps credentials and host', () => {
    expect(testRedisUrl({ REDIS_URL: 'redis://:secret@127.0.0.1:6379' })).toBe(
      'redis://:secret@127.0.0.1:6379/15',
    );
  });

  it('replaces a database that is already in the url', () => {
    expect(testRedisUrl({ REDIS_URL: 'redis://:secret@127.0.0.1:6379/0' })).toBe(
      'redis://:secret@127.0.0.1:6379/15',
    );
  });

  it('requires REDIS_URL', () => {
    expect(() => testRedisUrl({})).toThrow('REDIS_URL');
  });
});
