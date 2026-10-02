import type { Request, Response } from 'express';
import {
  CORRELATION_ID_HEADER,
  CorrelationIdMiddleware,
} from './correlation-id.middleware';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function run(header: string | string[] | undefined): {
  req: Request;
  headers: Map<string, string>;
} {
  const req = {
    headers: header === undefined ? {} : { 'x-correlation-id': header },
  } as unknown as Request;
  const headers = new Map<string, string>();
  const res = {
    setHeader: (name: string, value: string) => headers.set(name, value),
  } as unknown as Response;
  const next = jest.fn();
  new CorrelationIdMiddleware().use(req, res, next);
  expect(next).toHaveBeenCalledTimes(1);
  expect(next).toHaveBeenCalledWith();
  return { req, headers };
}

describe('CorrelationIdMiddleware', () => {
  it('keeps a well-formed incoming id and echoes it', () => {
    const { req, headers } = run('abc-DEF-0123');
    expect(req.correlationId).toBe('abc-DEF-0123');
    expect(headers.get(CORRELATION_ID_HEADER)).toBe('abc-DEF-0123');
    expect(CORRELATION_ID_HEADER).toBe('X-Correlation-Id');
  });

  it('accepts the boundary lengths 8 and 64', () => {
    expect(run('a'.repeat(8)).req.correlationId).toBe('a'.repeat(8));
    expect(run('a'.repeat(64)).req.correlationId).toBe('a'.repeat(64));
  });

  it.each([
    ['missing', undefined],
    ['too short', 'a'.repeat(7)],
    ['too long', 'a'.repeat(65)],
    ['forbidden characters', 'abc def\r\nx-evil: 1'],
    ['an underscore', 'abcd_efgh'],
    ['repeated header', ['abcdefgh', 'ijklmnop']],
  ])('replaces a %s id with a random UUID', (_, header) => {
    const { req, headers } = run(header);
    expect(req.correlationId).toMatch(UUID);
    expect(headers.get(CORRELATION_ID_HEADER)).toBe(req.correlationId);
  });

  it('generates a new id per request', () => {
    expect(run(undefined).req.correlationId).not.toBe(
      run(undefined).req.correlationId,
    );
  });
});
