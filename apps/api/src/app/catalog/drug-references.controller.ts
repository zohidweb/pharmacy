import { Controller, Get, Query } from '@nestjs/common';
import type { DrugReferenceListResponse } from '@pharmacy/shared-dto';
import { RequirePermission } from '../auth/decorators';
import { DrugReferenceQueryDto } from './dto/catalog.dto';
import { DrugReferencesService } from './drug-references.service';

/**
 * The platform drug reference for the product card (plan 2026-11-11-drug-reference-seed, R9–R11): only who creates
 * products needs the template.
 */
@Controller({ path: 'catalog', version: '1' })
export class DrugReferencesController {
  constructor(private readonly references: DrugReferencesService) {}

  /** 400 `validation_failed` — `q` shorter than 2 or longer than 100 characters. */
  @RequirePermission('catalog:create')
  @Get('drug-references')
  search(
    @Query() query: DrugReferenceQueryDto,
  ): Promise<DrugReferenceListResponse> {
    return this.references.search(query);
  }
}
