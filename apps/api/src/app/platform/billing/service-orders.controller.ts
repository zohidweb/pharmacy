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
  Query,
} from '@nestjs/common';
import type {
  ServiceRequestItem,
  TenantServiceItem,
} from '@pharmacy/shared-dto';
import { RequireOperatorPermission } from '../auth/decorators';
import {
  AddTenantServiceDto,
  ApproveServiceRequestDto,
  CancelTenantServiceDto,
  ProvideTenantServiceDto,
  RejectServiceRequestDto,
  TenantServiceQueryDto,
  UpdateTenantServiceDto,
} from './dto/billing.dto';
import { ServiceOrdersService } from './service-orders.service';

const uuid = () => new ParseUUIDPipe();

// The requests of networks and the services of networks (spec 2026-10-15-billing-services, 6.1).
@Controller({ path: 'operator', version: '1' })
export class ServiceOrdersController {
  constructor(private readonly orders: ServiceOrdersService) {}

  @RequireOperatorPermission('tenants:view')
  @Get('service-requests')
  pending(): Promise<ServiceRequestItem[]> {
    return this.orders.pendingRequests();
  }

  /** 201; 404, 409 `service_decided`. */
  @RequireOperatorPermission('tenants:manage')
  @Post('service-requests/:id/approval')
  approve(
    @Param('id', uuid()) id: string,
    @Body() body: ApproveServiceRequestDto,
  ): Promise<TenantServiceItem> {
    return this.orders.approve(id, body.priceMinor);
  }

  /** 201; 404, 409 `service_decided`. */
  @RequireOperatorPermission('tenants:manage')
  @Post('service-requests/:id/rejection')
  reject(
    @Param('id', uuid()) id: string,
    @Body() body: RejectServiceRequestDto,
  ): Promise<TenantServiceItem> {
    return this.orders.reject(id, body.reason);
  }

  @RequireOperatorPermission('tenants:view')
  @Get('tenant-services')
  list(@Query() query: TenantServiceQueryDto): Promise<TenantServiceItem[]> {
    return this.orders.list(query);
  }

  /** 404 for an unknown network. */
  @RequireOperatorPermission('tenants:view')
  @Get('tenants/:id/services')
  ofTenant(@Param('id', uuid()) id: string): Promise<TenantServiceItem[]> {
    return this.orders.ofTenant(id);
  }

  /** 201, approved at once; 404 (network, unknown or archived service), 409 `idempotency_conflict`. */
  @RequireOperatorPermission('tenants:manage')
  @Post('tenants/:id/services')
  add(
    @Param('id', uuid()) id: string,
    @Body() body: AddTenantServiceDto,
  ): Promise<TenantServiceItem> {
    return this.orders.add(id, body.serviceId, body.priceMinor, body.id);
  }

  /** 400 (`providedOn`: `future`, `before_decision`), 404, 409 `service_not_approved`. */
  @RequireOperatorPermission('tenants:manage')
  @Post('tenant-services/:id/provision')
  @HttpCode(HttpStatus.OK)
  provide(
    @Param('id', uuid()) id: string,
    @Body() body: ProvideTenantServiceDto,
  ): Promise<TenantServiceItem> {
    return this.orders.provide(id, body.providedOn);
  }

  /** 404, 409 `service_not_approved` (not provided). */
  @RequireOperatorPermission('tenants:manage')
  @Delete('tenant-services/:id/provision')
  undoProvision(@Param('id', uuid()) id: string): Promise<TenantServiceItem> {
    return this.orders.undoProvision(id);
  }

  /** 404, 409 `service_not_approved` (rejected or cancelled). */
  @RequireOperatorPermission('tenants:manage')
  @Patch('tenant-services/:id')
  updatePrice(
    @Param('id', uuid()) id: string,
    @Body() body: UpdateTenantServiceDto,
  ): Promise<TenantServiceItem> {
    return this.orders.updatePrice(id, body.priceMinor);
  }

  /** 404, 409 `service_not_approved` (rejected or cancelled). */
  @RequireOperatorPermission('tenants:manage')
  @Post('tenant-services/:id/cancellation')
  @HttpCode(HttpStatus.OK)
  cancel(
    @Param('id', uuid()) id: string,
    @Body() body: CancelTenantServiceDto,
  ): Promise<TenantServiceItem> {
    return this.orders.cancel(id, body.reason);
  }
}
