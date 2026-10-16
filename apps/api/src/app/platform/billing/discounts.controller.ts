import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import type { TenantDiscount } from '@pharmacy/shared-dto';
import { RequireFreshAuth } from '../../../common/guards/decorators';
import { RequireOperatorPermission } from '../auth/decorators';
import { DiscountsService } from './discounts.service';
import {
  AddTenantDiscountDto,
  ShortenTenantDiscountDto,
} from './dto/discounts.dto';

const uuid = () => new ParseUUIDPipe();

// Discounts of networks (spec 2026-10-15-billing-services, A10, A15): reading — tenants:view; every
// change — tenants:manage and a recent sign-in (403 `fresh_auth_required`).
@Controller({ path: 'operator', version: '1' })
export class DiscountsController {
  constructor(private readonly discounts: DiscountsService) {}

  /** 404 for an unknown network. */
  @RequireOperatorPermission('tenants:view')
  @Get('tenants/:id/discounts')
  list(@Param('id', uuid()) id: string): Promise<TenantDiscount[]> {
    return this.discounts.list(id);
  }

  /** 201; 400, 404, 409 `discount_overlap`. */
  @RequireOperatorPermission('tenants:manage')
  @RequireFreshAuth()
  @Post('tenants/:id/discounts')
  add(
    @Param('id', uuid()) id: string,
    @Body() body: AddTenantDiscountDto,
  ): Promise<TenantDiscount> {
    return this.discounts.add(id, body);
  }

  /** 400 `order`, `not_shorter`; 404; 409 `discount_invoiced`. */
  @RequireOperatorPermission('tenants:manage')
  @RequireFreshAuth()
  @Patch('discounts/:id')
  shorten(
    @Param('id', uuid()) id: string,
    @Body() body: ShortenTenantDiscountDto,
  ): Promise<TenantDiscount> {
    return this.discounts.shorten(id, body.toMonth);
  }

  /** 204; 404, 409 `discount_invoiced`. */
  @RequireOperatorPermission('tenants:manage')
  @RequireFreshAuth()
  @Delete('discounts/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', uuid()) id: string): Promise<void> {
    return this.discounts.remove(id);
  }
}
