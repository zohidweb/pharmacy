import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../../common/guards/decorators';
import { ActivationsService } from './activations.service';
import { ActivationDto } from './dto/activation.dto';
import { AUTH_ROUTE_LIMIT } from '../../common/throttling/auth-route-limit';

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
  async activate(
    @Body() body: ActivationDto,
    @Req() req: Request,
  ): Promise<void> {
    // The address goes to the journal of a lock (security review P2).
    await this.activations.activate(
      body.login,
      body.code,
      body.newPassword,
      req.ip ?? '',
    );
  }
}
