import { ConfigService } from '@nestjs/config';
import { httpContext, problemOf, type TestRequest } from '../../../test/guards';
import { CsrfGuard } from './csrf.guard';
import { Public } from './decorators';

// CsrfGuard matrix (ADR-0008; auth design 2026-10-02, section 7, guard 2): unsafe methods need a
// same-origin Fetch Metadata header or, without it, the exact web Origin; a body must be JSON.

const WEB_ORIGIN = 'https://app.pharmacy.test';
const JSON_TYPE = 'application/json';

class Controller {
  handle(): void {
    return undefined;
  }

  @Public()
  login(): void {
    return undefined;
  }
}

const guard = new CsrfGuard(new ConfigService({ WEB_ORIGIN }));

function check(request: TestRequest, handler = 'handle'): boolean {
  return guard.canActivate(httpContext(Controller, handler, request));
}

const withBody = (headers: Record<string, string>) => ({
  'content-length': '2',
  ...headers,
});

describe('CsrfGuard', () => {
  it.each(['GET', 'HEAD', 'OPTIONS'])(
    'lets %s through without any header',
    (method) => {
      expect(
        check({ method, headers: { 'sec-fetch-site': 'cross-site' } }),
      ).toBe(true);
    },
  );

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'lets %s with Sec-Fetch-Site: same-origin and a JSON body through',
    (method) => {
      expect(
        check({
          method,
          headers: withBody({
            'sec-fetch-site': 'same-origin',
            'content-type': JSON_TYPE,
          }),
        }),
      ).toBe(true);
    },
  );

  it('accepts a charset parameter on the JSON content type', () => {
    expect(
      check({
        method: 'POST',
        headers: withBody({
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/json; charset=utf-8',
        }),
      }),
    ).toBe(true);
  });

  it.each(['cross-site', 'same-site', 'none'])(
    'rejects Sec-Fetch-Site: %s with 403 csrf_rejected, even with the right Origin',
    async (site) => {
      await expect(
        problemOf(() =>
          check({
            method: 'POST',
            headers: withBody({
              'sec-fetch-site': site,
              origin: WEB_ORIGIN,
              'content-type': JSON_TYPE,
            }),
          }),
        ),
      ).resolves.toEqual({ status: 403, code: 'csrf_rejected' });
    },
  );

  it('without Sec-Fetch-Site accepts the exact web Origin', () => {
    expect(
      check({
        method: 'POST',
        headers: withBody({ origin: WEB_ORIGIN, 'content-type': JSON_TYPE }),
      }),
    ).toBe(true);
  });

  it.each([
    ['another origin', 'https://evil.example'],
    ['a different port', 'https://app.pharmacy.test:8443'],
    ['http instead of https', 'http://app.pharmacy.test'],
    ['a trailing slash', 'https://app.pharmacy.test/'],
    ['null', 'null'],
  ])('without Sec-Fetch-Site rejects %s with 403', async (_, origin) => {
    await expect(
      problemOf(() =>
        check({
          method: 'POST',
          headers: withBody({ origin, 'content-type': JSON_TYPE }),
        }),
      ),
    ).resolves.toEqual({ status: 403, code: 'csrf_rejected' });
  });

  it('rejects an unsafe request with neither Sec-Fetch-Site nor Origin', async () => {
    await expect(
      problemOf(() =>
        check({
          method: 'POST',
          headers: withBody({ 'content-type': JSON_TYPE }),
        }),
      ),
    ).resolves.toEqual({ status: 403, code: 'csrf_rejected' });
  });

  it.each([
    'application/x-www-form-urlencoded',
    'text/plain',
    'multipart/form-data; boundary=x',
  ])('rejects a %s body with 403', async (contentType) => {
    await expect(
      problemOf(() =>
        check({
          method: 'POST',
          headers: withBody({
            'sec-fetch-site': 'same-origin',
            'content-type': contentType,
          }),
        }),
      ),
    ).resolves.toEqual({ status: 403, code: 'csrf_rejected' });
  });

  it('rejects a body without a content type', async () => {
    await expect(
      problemOf(() =>
        check({
          method: 'POST',
          headers: withBody({ 'sec-fetch-site': 'same-origin' }),
        }),
      ),
    ).resolves.toEqual({ status: 403, code: 'csrf_rejected' });
  });

  it('rejects a chunked body that is not JSON', async () => {
    await expect(
      problemOf(() =>
        check({
          method: 'POST',
          headers: {
            'sec-fetch-site': 'same-origin',
            'transfer-encoding': 'chunked',
            'content-type': 'text/plain',
          },
        }),
      ),
    ).resolves.toEqual({ status: 403, code: 'csrf_rejected' });
  });

  it('needs no content type for a body-less DELETE', () => {
    expect(
      check({ method: 'DELETE', headers: { 'sec-fetch-site': 'same-origin' } }),
    ).toBe(true);
    expect(
      check({
        method: 'DELETE',
        headers: { origin: WEB_ORIGIN, 'content-length': '0' },
      }),
    ).toBe(true);
  });

  it('rejects a body-less request that declares a non-JSON content type', async () => {
    await expect(
      problemOf(() =>
        check({
          method: 'POST',
          headers: {
            'sec-fetch-site': 'same-origin',
            'content-type': 'text/plain',
          },
        }),
      ),
    ).resolves.toEqual({ status: 403, code: 'csrf_rejected' });
  });

  it('checks @Public() routes too (login is a public POST)', async () => {
    await expect(
      problemOf(() =>
        check(
          {
            method: 'POST',
            headers: withBody({
              'sec-fetch-site': 'cross-site',
              'content-type': JSON_TYPE,
            }),
          },
          'login',
        ),
      ),
    ).resolves.toEqual({ status: 403, code: 'csrf_rejected' });
  });

  it('fails to construct without WEB_ORIGIN', () => {
    // ConfigService falls back to process.env, where Nx loads the developer's .env: clear it here.
    const saved = process.env['WEB_ORIGIN'];
    delete process.env['WEB_ORIGIN'];
    try {
      expect(() => new CsrfGuard(new ConfigService({}))).toThrow();
    } finally {
      if (saved !== undefined) process.env['WEB_ORIGIN'] = saved;
    }
  });
});
