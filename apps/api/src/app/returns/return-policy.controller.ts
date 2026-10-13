import { Body, Controller, Get, Put } from '@nestjs/common';
import type { ReturnPolicy } from '@pharmacy/shared-dto';
import { RequirePermission } from '../auth/decorators';
import { ReturnPolicyDto } from './dto/returns.dto';
import { ReturnPolicyService } from './return-policy.service';

// The return window and policy of the network (spec 2026-10-13-customer-returns, 4.5).
@Controller({ path: 'settings/returns', version: '1' })
export class ReturnPolicyController {
  constructor(private readonly policy: ReturnPolicyService) {}

  @RequirePermission('settings:view')
  @Get()
  get(): Promise<ReturnPolicy> {
    return this.policy.get();
  }

  /** 400 `validation_failed` (window 0–365). */
  @RequirePermission('settings:update')
  @Put()
  update(@Body() body: ReturnPolicyDto): Promise<ReturnPolicy> {
    return this.policy.update(body);
  }
}
