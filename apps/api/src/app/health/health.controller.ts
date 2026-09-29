import { Controller, Get } from '@nestjs/common';

// Liveness probe. Readiness checks for PostgreSQL and Redis are added with the data layer.
@Controller('health')
export class HealthController {
  @Get()
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
