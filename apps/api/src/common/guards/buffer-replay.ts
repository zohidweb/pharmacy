import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { EmployeePrincipal } from '../context/request-context';
import { BUFFER_REPLAY_KEY } from './decorators';

/** The route is a buffered operation of the POS (@BufferReplay). */
export function isBufferReplay(
  reflector: Reflector,
  context: ExecutionContext,
): boolean {
  return (
    reflector.get<boolean | undefined>(
      BUFFER_REPLAY_KEY,
      context.getHandler(),
    ) === true
  );
}

/**
 * How a buffered operation of the POS is taken (spec 2026-10-21-pos-offline-limits, P9): `own` — a PIN session of a
 * terminal whose employee is the author of the operation (as before, the session's right applies); `terminal` — any
 * other request (no session, a password session, a PIN session of another cashier), sent under the bound terminal.
 * The body is the raw one (the guards run before validation): a missing author is `terminal`.
 */
export function bufferReplayMode(
  principal: EmployeePrincipal | null,
  body: unknown,
): 'own' | 'terminal' {
  if (principal?.auth !== 'pin' || principal.terminalId === null) {
    return 'terminal';
  }
  const author =
    typeof body === 'object' && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)['employeeId']
      : undefined;
  return typeof author === 'string' &&
    author.toLowerCase() === principal.employeeId
    ? 'own'
    : 'terminal';
}
