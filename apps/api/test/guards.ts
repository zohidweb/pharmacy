import type { ExecutionContext } from '@nestjs/common';
import { ProblemException } from '../src/common/errors/problem.exception';
import {
  type EmployeePrincipal,
  runWithContext,
} from '../src/common/context/request-context';

// Test helpers for guards: an HTTP ExecutionContext over a plain request object and a principal
// factory. Guards read the principal from the request context, so runAs runs them inside one.

export const TEST_TENANT = '0197a1b2-0000-7000-8000-00000000a001';
export const TEST_EMPLOYEE = '0197a1b2-0000-7000-8000-00000000a002';
export const TEST_STORE_1 = '0197a1b2-0000-7000-8000-00000000a011';
export const TEST_STORE_2 = '0197a1b2-0000-7000-8000-00000000a012';
export const TEST_CORRELATION = 'corr-guards-0001';

export interface TestRequest {
  method?: string;
  headers?: Record<string, string>;
  params?: Record<string, string>;
  query?: Record<string, unknown>;
  body?: unknown;
  ip?: string;
}

export interface TestResponse {
  headers: Record<string, string | number>;
  header(name: string, value: string | number): void;
}

export function testResponse(): TestResponse {
  const headers: Record<string, string | number> = {};
  return {
    headers,
    header(name, value) {
      headers[name] = value;
    },
  };
}

// The handler must be a method of the class so that metadata set by decorators is found.
export function httpContext(
  controller: new () => object,
  handlerName: string,
  request: TestRequest = {},
  response: TestResponse = testResponse(),
): ExecutionContext {
  const handler = (controller.prototype as Record<string, unknown>)[
    handlerName
  ];
  if (typeof handler !== 'function') {
    throw new Error(`No handler ${handlerName} on ${controller.name}`);
  }
  const req = {
    method: 'GET',
    headers: {},
    params: {},
    query: {},
    ip: '203.0.113.7',
    ...request,
  };
  return {
    getType: () => 'http',
    getClass: () => controller,
    getHandler: () => handler,
    getArgs: () => [req, response],
    getArgByIndex: (index: number) => [req, response][index],
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => response,
      getNext: () => undefined,
    }),
    switchToRpc: () => {
      throw new Error('not rpc');
    },
    switchToWs: () => {
      throw new Error('not ws');
    },
  } as unknown as ExecutionContext;
}

export function testPrincipal(
  overrides: Partial<EmployeePrincipal> = {},
): EmployeePrincipal {
  return {
    kind: 'employee',
    tenantId: TEST_TENANT,
    employeeId: TEST_EMPLOYEE,
    sessionId: 'session-guards-1',
    auth: 'password',
    authenticatedAt: new Date().toISOString(),
    permissions: ['pos:view', 'catalog:view'],
    storeScope: 'all',
    currentStoreId: null,
    terminalId: null,
    locale: 'ru',
    ...overrides,
  };
}

/** Runs fn inside a request context of the principal (null = guest). */
export function runAs<T>(principal: EmployeePrincipal | null, fn: () => T): T {
  return runWithContext(
    {
      correlationId: TEST_CORRELATION,
      tenantId: principal?.tenantId,
      principal,
    },
    fn,
  );
}

export interface ProblemShape {
  status: number;
  code: string;
}

function toProblemShape(error: unknown): ProblemShape {
  if (error instanceof ProblemException) {
    return { status: error.getStatus(), code: error.code };
  }
  throw new Error(`Expected a ProblemException, got ${String(error)}`);
}

/** The status and code of the ProblemException thrown (sync or async) by fn. */
export async function problemOf(fn: () => unknown): Promise<ProblemShape> {
  try {
    await fn();
  } catch (error) {
    return toProblemShape(error);
  }
  throw new Error('Expected a ProblemException, nothing was thrown');
}
