import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Public } from '../../common/guards/decorators';
import { ActivationsService } from './activations.service';
import { ActivationDto } from './dto/activation.dto';

// Activation of an owner by a one-time code (auth design 2026-10-02, section 6). No cookie: the
// client signs in with POST /sessions afterwards.
@Controller({ path: 'activations', version: '1' })
export class ActivationsController {
  constructor(private readonly activations: ActivationsService) {}

  /** 204; 401 invalid_code, 422 password_policy, 429 login_locked. */
  @Public()
  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  async activate(@Body() body: ActivationDto): Promise<void> {
    await this.activations.activate(body.login, body.code, body.newPassword);
  }
}
