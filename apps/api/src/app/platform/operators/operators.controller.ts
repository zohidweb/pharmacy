import { Controller, Get } from '@nestjs/common';
import type { PlatformOperator } from '@pharmacy/shared-dto';
import { RequireOperatorPermission } from '../auth/decorators';
import { OperatorsService } from './operators.service';

// The platform team, read only for now: operators are created by create-operator.mjs.
@Controller({ path: 'operator/operators', version: '1' })
export class OperatorsController {
  constructor(private readonly operators: OperatorsService) {}

  @RequireOperatorPermission('platform:view')
  @Get()
  list(): Promise<PlatformOperator[]> {
    return this.operators.list();
  }
}
