import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { EmployeeSession } from '@pharmacy/shared-dto';
import type { Request, Response } from 'express';
import { Authenticated, Public } from '../../common/guards/decorators';
import { ConfirmSessionDto } from './dto/confirm-session.dto';
import { EmployeeLoginDto } from './dto/employee-login.dto';
import { SelectStoreDto } from './dto/select-store.dto';
import {
  clearSessionCookie,
  type SessionCookieEnv,
  setSessionCookie,
  cookieEnvFrom,
} from './session-cookie';
import { SessionsService } from './sessions.service';

// Per IP and minute; the per-identifier lockout (LoginLimiter) is the main brute-force guard.
const AUTH_ROUTE_LIMIT = { limit: 60, ttl: 60_000 };

// Employee sessions of the web contour (auth design 2026-10-02, section 6): sign-in by password,
// the session profile, the working store and sign-out. The JWT travels only in the session cookie.
@Controller({ path: 'sessions', version: '1' })
export class SessionsController {
  private readonly cookieEnv: SessionCookieEnv;

  constructor(
    private readonly sessions: SessionsService,
    config: ConfigService,
  ) {
    this.cookieEnv = cookieEnvFrom(config);
  }

  /** 201 EmployeeSession + Set-Cookie; 401 invalid_credentials, 429 login_locked. */
  @Public()
  @Throttle({ default: AUTH_ROUTE_LIMIT })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async login(
    @Body() body: EmployeeLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<EmployeeSession> {
    const { token, maxAgeSeconds, session } = await this.sessions.login(
      body.login,
      body.password,
      req.ip ?? '',
    );
    setSessionCookie(res, token, maxAgeSeconds, this.cookieEnv);
    return session;
  }

  @Authenticated()
  @Get('current')
  current(): Promise<EmployeeSession> {
    return this.sessions.current();
  }

  /** 403 forbidden for a store that is not active or not in the scope. */
  @Authenticated()
  @Put('current/store')
  selectStore(@Body() body: SelectStoreDto): Promise<EmployeeSession> {
    return this.sessions.selectStore(body.storeId);
  }

  /**
   * 204 — the password renews the fresh sign-in of this session (ADR-0008, amendment 2026-10-06).
   * 403 `password_session_required`, 422 `invalid_current_password`, 429 `login_locked`.
   */
  @Authenticated()
  @Throttle({ default: AUTH_ROUTE_LIMIT })
  @Post('current/confirmation')
  @HttpCode(HttpStatus.NO_CONTENT)
  confirm(@Body() body: ConfirmSessionDto): Promise<void> {
    return this.sessions.confirm(body.password);
  }

  @Authenticated()
  @Delete('current')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Res({ passthrough: true }) res: Response): Promise<void> {
    await this.sessions.logout();
    clearSessionCookie(res, this.cookieEnv);
  }
}
