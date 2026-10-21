/*
 * Mock handlers of loading data from a file (spec 2026-10-20-data-import). Placeholders until the
 * mocks repeat the API.
 */
import { ApiError } from '../client';
import type { ApiRouteKey } from '../routes';
import type { MockHandlers } from './types';

type ImportRoute = Extract<
  ApiRouteKey,
  `${'catalogImports' | 'openingBalanceImports' | 'supplierImports'}.${'check' | 'apply'}`
>;

const notYet = ({ correlationId }: { correlationId: string }): never => {
  throw new ApiError(501, 'not_implemented', correlationId);
};

export const importHandlers: Pick<MockHandlers, ImportRoute> = {
  'catalogImports.check': notYet,
  'catalogImports.apply': notYet,
  'openingBalanceImports.check': notYet,
  'openingBalanceImports.apply': notYet,
  'supplierImports.check': notYet,
  'supplierImports.apply': notYet,
};
