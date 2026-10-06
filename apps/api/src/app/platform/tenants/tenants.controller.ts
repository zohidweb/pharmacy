import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import type {
  CreateTenantResponse,
  IssueOwnerCodeResponse,
  StoreSummary,
  TenantDetails,
  TenantListResponse,
} from '@pharmacy/shared-dto';
import { RequireFreshAuth } from '../../../common/guards/decorators';
import { RequireOperatorPermission } from '../auth/decorators';
import { BlockTenantDto, CreateTenantDto, TenantListQueryDto } from './dto/tenant.dto';
import { TenantsService } from './tenants.service';

const DEFAULT_LIMIT = 20;

// Networks of the platform, the operator contour (spec 2026-10-05-tenants-module, section 3).
@Controller({ path: 'operator/tenants', version: '1' })
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @RequireOperatorPermission('tenants:view')
  @Get()
  list(@Query() query: TenantListQueryDto): Promise<TenantListResponse> {
    return this.tenants.list({
      filter: query.filter ?? 'all',
      q: query.q ? query.q : null,
      sort: query.sort ?? 'name',
      direction: query.direction ?? 'asc',
      limit: query.limit ?? DEFAULT_LIMIT,
      offset: query.offset ?? 0,
    });
  }

  @RequireOperatorPermission('tenants:view')
  @Get(':id')
  details(@Param('id', new ParseUUIDPipe()) id: string): Promise<TenantDetails> {
    return this.tenants.details(id);
  }

  @RequireOperatorPermission('tenants:view')
  @Get(':id/stores')
  stores(@Param('id', new ParseUUIDPipe()) id: string): Promise<StoreSummary[]> {
    return this.tenants.stores(id);
  }

  /** 201 `{ id, activationCode }` — the code is shown once. 409 `*_taken`. */
  @RequireOperatorPermission('tenants:manage')
  @RequireFreshAuth()
  @Post()
  create(@Body() body: CreateTenantDto): Promise<CreateTenantResponse> {
    return this.tenants.create(body);
  }

  /** 201 `{ activationCode }` — a new code for the owner. 404, 409 `tenant_blocked`. */
  @RequireOperatorPermission('tenants:manage')
  @RequireFreshAuth()
  @Post(':id/owner-activation-codes')
  issueOwnerCode(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<IssueOwnerCodeResponse> {
    return this.tenants.issueOwnerCode(id);
  }

  /** The network's sessions end on their next request. 404, 409 `already_blocked`. */
  @RequireOperatorPermission('tenants:manage')
  @RequireFreshAuth()
  @Post(':id/block')
  @HttpCode(HttpStatus.OK)
  block(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: BlockTenantDto,
  ): Promise<TenantDetails> {
    return this.tenants.block(id, body.reason);
  }

  /** 404, 409 `not_blocked`. */
  @RequireOperatorPermission('tenants:manage')
  @RequireFreshAuth()
  @Post(':id/unblock')
  @HttpCode(HttpStatus.OK)
  unblock(@Param('id', new ParseUUIDPipe()) id: string): Promise<TenantDetails> {
    return this.tenants.unblock(id);
  }
}
