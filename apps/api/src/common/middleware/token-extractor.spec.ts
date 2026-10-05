import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { CookieTokenExtractor } from './token-extractor';

const req = (cookies: unknown): Request => ({ cookies }) as unknown as Request;

describe('CookieTokenExtractor', () => {
  const prod = new CookieTokenExtractor(
    new ConfigService({ AUTH_TEST_COOKIES: false }),
  );
  const e2e = new CookieTokenExtractor(
    new ConfigService({ AUTH_TEST_COOKIES: true }),
  );

  it('reads __Host-sid, or sid with AUTH_TEST_COOKIES=true', () => {
    expect(prod.extract(req({ '__Host-sid': 'jwt-1', sid: 'jwt-2' }))).toBe(
      'jwt-1',
    );
    expect(e2e.extract(req({ '__Host-sid': 'jwt-1', sid: 'jwt-2' }))).toBe(
      'jwt-2',
    );
  });

  it('ignores the cookie of the other mode', () => {
    expect(prod.extract(req({ sid: 'jwt-2' }))).toBeNull();
    expect(e2e.extract(req({ '__Host-sid': 'jwt-1' }))).toBeNull();
  });

  it.each([
    ['no cookie-parser', undefined],
    ['no cookies', {}],
    ['an empty value', { '__Host-sid': '' }],
    ['a JSON cookie parsed into an object', { '__Host-sid': { a: 1 } }],
  ])('returns null for %s', (_, cookies) => {
    expect(prod.extract(req(cookies))).toBeNull();
  });
});
