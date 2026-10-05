import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MyTerminal } from '@pharmacy/shared-dto';
import type { Request } from 'express';
import {
  Authenticated,
  RequireFreshAuth,
} from '../../common/guards/decorators';
import { readDeviceSecret } from '../auth/device-cookie';
import type { SessionCookieEnv } from '../auth/session-cookie';
import { ChangePinDto } from './dto/terminal.dto';
import { MePinService } from './me-pin.service';

// The own PIN and terminals of the signed-in employee (auth design 2026-10-02, section 8). Personal
// data of the employee himself: a session, no catalog permission.
@Controller({ path: 'me', version: '1' })
export class MePinController {
  private readonly cookieEnv: SessionCookieEnv;

  constructor(
    private readonly mePin: MePinService,
    config: ConfigService,
  ) {
    this.cookieEnv = {
      AUTH_TEST_COOKIES: config.getOrThrow<boolean>('AUTH_TEST_COOKIES'),
    };
  }

  /**
   * 204. Only in a fresh password session (403 `fresh_auth_required`); 422
   * `invalid_current_pin` (errors[{ field: 'currentPin' }]), `pin_length`, `pin_trivial`;
   * 429 `login_locked` after 5 wrong current PINs in 15 minutes.
   */
  @Authenticated()
  @RequireFreshAuth()
  @Post('pin')
  @HttpCode(HttpStatus.NO_CONTENT)
  changePin(@Body() body: ChangePinDto): Promise<void> {
    return this.mePin.changePin(body.currentPin ?? null, body.newPin);
  }

  @Authenticated()
  @Get('terminals')
  myTerminals(@Req() req: Request): Promise<MyTerminal[]> {
    return this.mePin.myTerminals(readDeviceSecret(req, this.cookieEnv));
  }
}
