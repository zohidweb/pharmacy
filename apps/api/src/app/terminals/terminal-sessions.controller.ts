import { Body, Controller, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { EmployeeSession } from '@pharmacy/shared-dto';
import type { Request, Response } from 'express';
import { Public } from '../../common/guards/decorators';
import { readDeviceSecret } from '../auth/device-cookie';
import {
  type SessionCookieEnv,
  setSessionCookie,
  cookieEnvFrom,
} from '../auth/session-cookie';
import { PinLoginDto } from './dto/terminal.dto';
import { TerminalSessionsService } from './terminal-sessions.service';

// Per IP, on top of the per-terminal PIN failure limit; the same bound as password sign-in.
const AUTH_ROUTE_LIMIT = { limit: 60, ttl: 60_000 };

// PIN sign-in on a bound terminal (auth design 2026-10-02, section 8).
@Controller({ path: 'terminal-sessions', version: '1' })
export class TerminalSessionsController {
  private readonly cookieEnv: SessionCookieEnv;

  constructor(
    private readonly terminalSessions: TerminalSessionsService,
    config: ConfigService,
  ) {
    this.cookieEnv = cookieEnvFrom(config);
  }

  /**
   * 201 `EmployeeSession` + the session cookie. 401 `invalid_pin`, 404 `not_bound`,
   * 423 `pin_locked` (sign-in by password only), 423 `terminal_locked`.
   */
  @Public()
  @Throttle({ default: AUTH_ROUTE_LIMIT })
  @Post()
  async login(
    @Body() body: PinLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<EmployeeSession> {
    const { token, maxAgeSeconds, session } = await this.terminalSessions.login(
      readDeviceSecret(req, this.cookieEnv),
      body.employeeId,
      body.pin,
    );
    setSessionCookie(res, token, maxAgeSeconds, this.cookieEnv);
    return session;
  }
}
