import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import type { ServiceOrder, TenantServices } from '@pharmacy/shared-dto';
import { RequirePermission } from '../auth/decorators';
import { CreateServiceRequestDto } from './dto/services.dto';
import { OwnerServicesService } from './owner-services.service';

// The services of the owner cabinet (spec 2026-10-15-billing-services, 6.2).
@Controller({ version: '1' })
export class OwnerServicesController {
  constructor(private readonly services: OwnerServicesService) {}

  /** The visible catalog and the orders of the network. */
  @RequirePermission('services:view')
  @Get('services')
  list(): Promise<TenantServices> {
    return this.services.list();
  }

  /** 201; 404 (unknown, hidden or archived service), 409 `service_requested`. */
  @RequirePermission('services:create')
  @Post('service-requests')
  request(@Body() body: CreateServiceRequestDto): Promise<ServiceOrder> {
    return this.services.request(body);
  }

  /** 204; 404, 409 `service_decided`. */
  @RequirePermission('services:create')
  @Delete('service-requests/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  withdraw(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    return this.services.withdraw(id);
  }
}
