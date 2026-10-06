import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import type { LegalEntitiesResponse, LegalEntity } from '@pharmacy/shared-dto';
import { RequirePermission } from '../auth/decorators';
import { LegalEntityInputDto, UpdateLegalEntityDto } from './dto/store.dto';
import { LegalEntitiesService } from './legal-entities.service';

// Legal entities of the network (spec 2026-10-06-owner-stores, section 3): managed with the store
// permissions, since the owner creates them in the store form.
@Controller({ path: 'legal-entities', version: '1' })
export class LegalEntitiesController {
  constructor(private readonly legalEntities: LegalEntitiesService) {}

  /** Active legal entities and the network's name and INN for the first one. */
  @RequirePermission('stores:view')
  @Get()
  list(): Promise<LegalEntitiesResponse> {
    return this.legalEntities.list();
  }

  /** 201 `LegalEntity`; 409 `tax_id_taken`. */
  @RequirePermission('stores:create')
  @Post()
  create(@Body() body: LegalEntityInputDto): Promise<LegalEntity> {
    return this.legalEntities.create(body);
  }

  /** 404, 409 `tax_id_taken`. */
  @RequirePermission('stores:update')
  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateLegalEntityDto,
  ): Promise<LegalEntity> {
    return this.legalEntities.update(id, body);
  }
}
