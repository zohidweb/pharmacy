import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import type { DiscountRuleDefinition } from '@pharmacy/shared-dto';
import { RequirePermission } from '../auth/decorators';
import { DiscountRulesService } from './discount-rules.service';
import { DiscountRuleInputDto } from './dto/pricing.dto';

// Discount rules (spec 2026-10-07-catalog-pricing, section 6). Writes also need
// discounts:manage-store or discounts:manage-network, checked by the service.
@Controller({ path: 'discount-rules', version: '1' })
export class DiscountRulesController {
  constructor(private readonly rules: DiscountRulesService) {}

  @RequirePermission('discounts:view')
  @Get()
  list(): Promise<DiscountRuleDefinition[]> {
    return this.rules.list();
  }

  /** 201; 400 `validation_failed`, 403 `forbidden` / `store_not_in_scope`, 404 (a store). */
  @RequirePermission('discounts:view')
  @Post()
  create(@Body() body: DiscountRuleInputDto): Promise<DiscountRuleDefinition> {
    return this.rules.create(body);
  }

  /** 400, 403 `forbidden` / `store_not_in_scope`, 404 (the rule or a store). */
  @RequirePermission('discounts:view')
  @Put(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: DiscountRuleInputDto,
  ): Promise<DiscountRuleDefinition> {
    return this.rules.update(id, body);
  }
}
