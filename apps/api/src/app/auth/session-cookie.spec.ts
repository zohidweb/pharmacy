import type { AddressInfo } from 'node:net';
import express, { type Response } from 'express';
import {
  clearSessionCookie,
  sessionCookieName,
  setSessionCookie,
} from './session-cookie';

// The Set-Cookie header produced by a real Express response.
async function setCookieHeaders(
  handler: (res: Response) => void,
): Promise<string[]> {
  const app = express();
  app.get('/', (_req, res) => {
    handler(res);
    res.end();
  });
  const server = app.listen(0);
  try {
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}/`);
    return response.headers.getSetCookie();
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const attributes = (header: string): string[] =>
  header
    .split(';')
    .slice(1)
    .map((part) => part.trim());

const PROD = { AUTH_TEST_COOKIES: false };
const E2E = { AUTH_TEST_COOKIES: true };

describe('session cookie', () => {
  it('uses the __Host- prefix unless AUTH_TEST_COOKIES=true', () => {
    expect(sessionCookieName(PROD)).toBe('__Host-sid');
    expect(sessionCookieName(E2E)).toBe('sid');
  });

  it('sets __Host-sid with Secure, HttpOnly, SameSite=Strict, Path=/ and Max-Age', async () => {
    const [header, ...rest] = await setCookieHeaders((res) =>
      setSessionCookie(res, 'token-value', 43200, PROD),
    );
    expect(rest).toEqual([]);
    expect(header.startsWith('__Host-sid=token-value;')).toBe(true);
    expect(attributes(header)).toEqual(
      expect.arrayContaining([
        'Max-Age=43200',
        'Path=/',
        'HttpOnly',
        'Secure',
        'SameSite=Strict',
      ]),
    );
    expect(header).not.toMatch(/Domain=/i);
  });

  it('sets sid without Secure only for AUTH_TEST_COOKIES=true', async () => {
    const [header] = await setCookieHeaders((res) =>
      setSessionCookie(res, 'token-value', 60, E2E),
    );
    expect(header.startsWith('sid=token-value;')).toBe(true);
    expect(attributes(header)).toEqual(
      expect.arrayContaining([
        'Max-Age=60',
        'Path=/',
        'HttpOnly',
        'SameSite=Strict',
      ]),
    );
    expect(attributes(header)).not.toContain('Secure');
  });

  it('clears the cookie with the same attributes and an expiry in the past', async () => {
    const [header] = await setCookieHeaders((res) =>
      clearSessionCookie(res, PROD),
    );
    expect(header.startsWith('__Host-sid=;')).toBe(true);
    expect(attributes(header)).toEqual(
      expect.arrayContaining([
        'Path=/',
        'HttpOnly',
        'Secure',
        'SameSite=Strict',
      ]),
    );
    expect(header).toMatch(/Expires=Thu, 01 Jan 1970 00:00:00 GMT/);
  });

  it('clears the test cookie without Secure', async () => {
    const [header] = await setCookieHeaders((res) =>
      clearSessionCookie(res, E2E),
    );
    expect(header.startsWith('sid=;')).toBe(true);
    expect(attributes(header)).not.toContain('Secure');
  });
});
