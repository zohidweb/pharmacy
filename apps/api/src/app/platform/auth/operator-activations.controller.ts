import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../../common/guards/decorators';
import { AUTH_ROUTE_LIMIT } from '../../../common/throttling/auth-route-limit';
import { OperatorActivationDto } from './dto/operator.dto';
import { OperatorActivationsService } from './operator-activations.service';

// The first password of an operator by a one-time code (plan decision P1).
@Controller({ path: 'operator/activations', version: '1' })
export class OperatorActivationsController {
  constructor(private readonly activations: OperatorActivationsService) {}

  /** 204; 401 `invalid_code`, 422 `password_policy`, 429 `login_locked`. */
  @Public()
  @Throttle({ default: AUTH_ROUTE_LIMIT })
  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  activate(@Body() body: OperatorActivationDto): Promise<void> {
    return this.activations.activate(body.login, body.code, body.newPassword);
  }
}
