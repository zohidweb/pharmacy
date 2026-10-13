import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { OperatorSession } from '@pharmacy/shared-dto';
import type { Request, Response } from 'express';
import { Public } from '../../../common/guards/decorators';
import {
  clearOperatorCookie,
  type SessionCookieEnv,
  setOperatorCookie,
  cookieEnvFrom,
} from '../../auth/session-cookie';
import { RequireOperatorPermission } from './decorators';
import { OperatorLoginDto } from './dto/operator.dto';
import { OperatorSessionsService } from './operator-sessions.service';
import { AUTH_ROUTE_LIMIT } from '../../../common/throttling/auth-route-limit';

// Sign-in and the session of a platform operator (auth design 2026-10-02, section 9).
@Controller({ path: 'operator/sessions', version: '1' })
export class OperatorSessionsController {
  private readonly cookieEnv: SessionCookieEnv;

  constructor(
    private readonly operatorSessions: OperatorSessionsService,
    config: ConfigService,
  ) {
    this.cookieEnv = cookieEnvFrom(config);
  }

  /** 201 `OperatorSession` + `__Host-op_sid`; 401 `invalid_credentials`, 429 `login_locked`. */
  @Public()
  @Throttle({ default: AUTH_ROUTE_LIMIT })
  @Post()
  async login(
    @Body() body: OperatorLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OperatorSession> {
    const { token, maxAgeSeconds, session } = await this.operatorSessions.login(
      body.login,
      body.password,
      req.ip ?? '',
    );
    setOperatorCookie(res, token, maxAgeSeconds, this.cookieEnv);
    return session;
  }

  @RequireOperatorPermission('platform:view')
  @Get('current')
  current(): Promise<OperatorSession> {
    return this.operatorSessions.current();
  }

  @RequireOperatorPermission('platform:view')
  @Delete('current')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Res({ passthrough: true }) res: Response): Promise<void> {
    await this.operatorSessions.logout();
    clearOperatorCookie(res, this.cookieEnv);
  }
}
