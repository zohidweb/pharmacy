import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import type { StoreDetails } from '@pharmacy/shared-dto';
import { RequireOperatorPermission } from '../auth/decorators';
import { TenantsService } from './tenants.service';

// A store of a network for the operator (spec 2026-10-23-admin-store-card-tenant-log, A1): the registry, the marts
// and the platform tables only (ADR-0013 §5). The owner of the network edits the store; the operator does not (A6).
// A static path under /operator/stores (such as `offline-options` of the admin) is declared here above `:id`:
// elsewhere `:id` with ParseUUIDPipe would answer it with 400.
@Controller({ path: 'operator/stores', version: '1' })
export class OperatorStoresController {
  constructor(private readonly tenants: TenantsService) {}

  /** 404 `not_found` — no such store. */
  @RequireOperatorPermission('tenants:view')
  @Get(':id')
  store(@Param('id', new ParseUUIDPipe()) id: string): Promise<StoreDetails> {
    return this.tenants.store(id);
  }
}
