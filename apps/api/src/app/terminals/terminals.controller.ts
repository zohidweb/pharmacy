import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { BoundTerminal } from '@pharmacy/shared-dto';
import type { Request, Response } from 'express';
import { Public, RequireFreshAuth } from '../../common/guards/decorators';
import { RequirePermission } from '../auth/decorators';
import { readDeviceSecret, setDeviceCookie } from '../auth/device-cookie';
import type { SessionCookieEnv } from '../auth/session-cookie';
import { BindTerminalDto } from './dto/terminal.dto';
import { TerminalsService } from './terminals.service';

// Terminals of the web contour (auth design 2026-10-02, section 8).
@Controller({ path: 'terminals', version: '1' })
export class TerminalsController {
  private readonly cookieEnv: SessionCookieEnv;

  constructor(
    private readonly terminals: TerminalsService,
    config: ConfigService,
  ) {
    this.cookieEnv = {
      AUTH_TEST_COOKIES: config.getOrThrow<boolean>('AUTH_TEST_COOKIES'),
    };
  }

  /**
   * Binds this browser to a store: 201 `BoundTerminal` + the device-cookie. 403
   * `fresh_auth_required`, 404 `not_found` (no such active store), 409 `terminal_name_taken`,
   * 422 `store_not_pharmacy`.
   */
  @RequirePermission('terminals:create', { storeBody: 'storeId' })
  @RequireFreshAuth()
  @Post()
  async bind(
    @Body() body: BindTerminalDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<BoundTerminal> {
    const { secret, terminal } = await this.terminals.bind(
      readDeviceSecret(req, this.cookieEnv),
      body.storeId,
      body.name,
    );
    setDeviceCookie(res, this.cookieEnv, secret);
    return terminal;
  }

  /** The terminal of this browser by its device-cookie; 404 `not_bound`. */
  @Public()
  @Get('current')
  current(@Req() req: Request): Promise<BoundTerminal> {
    return this.terminals.current(readDeviceSecret(req, this.cookieEnv));
  }

  /** Revokes a terminal of the principal's stores and ends its PIN session; 404 `not_found`. */
  @RequirePermission('terminals:delete')
  @RequireFreshAuth()
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  revoke(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    return this.terminals.revoke(id);
  }
}
