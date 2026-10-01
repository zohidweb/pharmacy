import { Logger } from '@nestjs/common';
import { Pool, types } from 'pg';
import type { CustomTypesConfig } from 'pg';

const INT8_OID = 20;
const DATE_OID = 1082;

// Per-pool type parsers (the global `types.setTypeParser` is deliberately not touched).
// int8 -> bigint keeps ids and money in dirams exact beyond 2^53; date stays a 'YYYY-MM-DD'
// string so no timezone shift can move a calendar date.
export const pgTypes: CustomTypesConfig = {
  getTypeParser: ((oid: number, format?: 'text' | 'binary') => {
    if (oid === INT8_OID) return (value: string) => BigInt(value);
    if (oid === DATE_OID) return (value: string) => value;
    return types.getTypeParser(oid, format as 'text');
  }) as CustomTypesConfig['getTypeParser'],
};

export interface PoolOptions {
  connectionString: string;
  applicationName: string;
  max: number;
  connectionTimeoutMillis: number;
}

export function createPool(options: PoolOptions): Pool {
  const pool = new Pool({
    connectionString: options.connectionString,
    application_name: options.applicationName,
    max: options.max,
    connectionTimeoutMillis: options.connectionTimeoutMillis,
    types: pgTypes,
  });
  const logger = new Logger(`Pool:${options.applicationName}`);
  // An error on an idle client must not crash the process; log the message only (never the connection string).
  pool.on('error', (error) => logger.error(`Idle client error: ${error.message}`));
  return pool;
}
