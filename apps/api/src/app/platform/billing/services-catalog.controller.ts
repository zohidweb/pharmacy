import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import type { PlatformService } from '@pharmacy/shared-dto';
import { RequireOperatorPermission } from '../auth/decorators';
import { UpsertServiceDto } from './dto/billing.dto';
import { ServicesCatalogService } from './services-catalog.service';

// The catalog of one-time services (spec 2026-10-15-billing-services, 6.1).
@Controller({ path: 'operator/services', version: '1' })
export class ServicesCatalogController {
  constructor(private readonly catalog: ServicesCatalogService) {}

  @RequireOperatorPermission('platform:view')
  @Get()
  list(): Promise<PlatformService[]> {
    return this.catalog.list();
  }

  /** 201; 400. */
  @RequireOperatorPermission('platform:manage')
  @Post()
  create(@Body() body: UpsertServiceDto): Promise<PlatformService> {
    return this.catalog.create(body);
  }

  /** 400, 404. */
  @RequireOperatorPermission('platform:manage')
  @Put(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpsertServiceDto,
  ): Promise<PlatformService> {
    return this.catalog.update(id, body);
  }
}
