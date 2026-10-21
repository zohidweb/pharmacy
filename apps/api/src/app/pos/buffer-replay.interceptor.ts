import { randomUUID } from 'node:crypto';
import {
  applyDecorators,
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import {
  getPrincipal,
  getRequestContext,
  runWithContext,
} from '../../common/context/request-context';
import { ProblemException } from '../../common/errors/problem.exception';
import { bufferReplayMode } from '../../common/guards/buffer-replay';
import { BufferReplay } from '../../common/guards/decorators';
import { readDeviceSecret } from '../auth/device-cookie';
import { cookieEnvFrom, type SessionCookieEnv } from '../auth/session-cookie';
import { TerminalsService } from '../terminals/terminals.service';

// A buffered operation of the POS sent under the bound terminal (spec 2026-10-21-pos-offline-limits, P9; ADR-0008,
// amendment 2026-10-21): when the author is not the employee of the PIN session of the request, the device-cookie
// names the terminal, and the handler runs in the tenant of the terminal without a principal. PosContext then checks
// that the author held the terminal at the moment of the operation (P10).
@Injectable()
export class BufferReplayInterceptor implements NestInterceptor {
  private readonly cookieEnv: SessionCookieEnv;

  constructor(
    private readonly terminals: TerminalsService,
    config: ConfigService,
  ) {
    this.cookieEnv = cookieEnvFrom(config);
  }

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const req = context.switchToHttp().getRequest<Request>();
    const principal = getPrincipal();
    if (bufferReplayMode(principal, req.body) === 'own') return next.handle();
    // as before for a request that cannot go under a terminal: a session without one, or no session at all
    const refused = () =>
      principal
        ? new ProblemException(403, 'terminal_required')
        : new ProblemException(401, 'unauthenticated');
    let device;
    try {
      device = await this.terminals.resolveDevice(
        readDeviceSecret(req, this.cookieEnv),
      );
    } catch (error) {
      if (error instanceof ProblemException && error.code === 'not_bound') {
        throw refused();
      }
      throw error;
    }
    if (principal && principal.tenantId !== device.tenantId) throw refused();
    const terminal = {
      tenantId: device.tenantId,
      storeId: device.storeId,
      terminalId: device.terminalId,
      sessionEmployeeId: principal?.employeeId ?? null,
    };
    const correlationId = getRequestContext()?.correlationId ?? randomUUID();
    return new Observable((subscriber) =>
      runWithContext(
        {
          correlationId,
          tenantId: terminal.tenantId,
          principal: null,
          terminal,
        },
        () => next.handle().subscribe(subscriber),
      ),
    );
  }
}

/** A buffered POS route: its own PIN session or the bound terminal (P9). */
export const BufferedOperation = () =>
  applyDecorators(BufferReplay(), UseInterceptors(BufferReplayInterceptor));
