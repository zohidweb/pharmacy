import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../common/guards/decorators';

// Liveness probe: public (no session) and outside the request limit. Readiness checks for
// PostgreSQL and Redis are added with the data layer.
@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  @Get()
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
