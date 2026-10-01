import { createPool, pgTypes } from './pool';

describe('pgTypes', () => {
  it('parses int8 into bigint without precision loss', () => {
    expect(pgTypes.getTypeParser(20, 'text')('9007199254740993')).toBe(9007199254740993n);
  });

  it('keeps date as a YYYY-MM-DD string', () => {
    expect(pgTypes.getTypeParser(1082, 'text')('2026-09-30')).toBe('2026-09-30');
  });

  it('leaves other types to pg defaults', () => {
    expect(pgTypes.getTypeParser(23, 'text')('42')).toBe(42);
  });
});

describe('createPool', () => {
  it('passes application_name, max and connection timeout to the pool', () => {
    const pool = createPool({
      connectionString: 'postgres://u:p@127.0.0.1:1/d',
      applicationName: 'api-tenant',
      max: 2,
      connectionTimeoutMillis: 100,
    });
    expect(pool.options).toMatchObject({ application_name: 'api-tenant', max: 2, connectionTimeoutMillis: 100 });
    return pool.end();
  });
});
