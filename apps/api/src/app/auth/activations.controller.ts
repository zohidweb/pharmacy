import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/guards/decorators';
import { ActivationsService } from './activations.service';
import { ActivationDto } from './dto/activation.dto';

// Per IP and minute; the code check shares the login limiter's per-identifier lockout.
const AUTH_ROUTE_LIMIT = { limit: 60, ttl: 60_000 };

// Activation of an owner by a one-time code (auth design 2026-10-02, section 6). No cookie: the
// client signs in with POST /sessions afterwards.
@Controller({ path: 'activations', version: '1' })
export class ActivationsController {
  constructor(private readonly activations: ActivationsService) {}

  /** 204; 401 invalid_code, 422 password_policy, 429 login_locked. */
  @Public()
  @Throttle({ default: AUTH_ROUTE_LIMIT })
  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  async activate(@Body() body: ActivationDto): Promise<void> {
    await this.activations.activate(body.login, body.code, body.newPassword);
  }
}
