import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import type { Category, CategoryMarkup } from '@pharmacy/shared-dto';
import { RequirePermission } from '../auth/decorators';
import { CategoriesService } from './categories.service';
import {
  CatalogStatusDto,
  CategoryInputDto,
  UpdateMarkupsDto,
} from './dto/catalog.dto';

// Categories of the network (spec 2026-10-07-catalog-pricing, section 5).
@Controller({ path: 'catalog/categories', version: '1' })
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @RequirePermission('catalog:view')
  @Get()
  list(): Promise<Category[]> {
    return this.categories.list();
  }

  /** 201; 409 `category_name_taken`. */
  @RequirePermission('catalog:update')
  @Post()
  create(@Body() body: CategoryInputDto): Promise<Category> {
    return this.categories.create(body);
  }

  /** 404, 409 `category_name_taken`. */
  @RequirePermission('catalog:update')
  @Put(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: CategoryInputDto,
  ): Promise<Category> {
    return this.categories.update(id, body);
  }

  /** Archive or restore; 409 `category_in_use` while it has active products. */
  @RequirePermission('catalog:update')
  @HttpCode(HttpStatus.OK)
  @Post(':id/status')
  setStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: CatalogStatusDto,
  ): Promise<Category> {
    return this.categories.setStatus(id, body.status);
  }
}

// Markups of the categories in the network settings (contract `settings.markups`).
@Controller({ path: 'settings/markups', version: '1' })
export class MarkupsController {
  constructor(private readonly categories: CategoriesService) {}

  @RequirePermission('settings:view')
  @Get()
  list(): Promise<CategoryMarkup[]> {
    return this.categories.markups();
  }

  /** 400 `validation_failed` (an unknown or archived category). */
  @RequirePermission('settings:update')
  @Put()
  update(@Body() body: UpdateMarkupsDto): Promise<CategoryMarkup[]> {
    return this.categories.updateMarkups(body);
  }
}
