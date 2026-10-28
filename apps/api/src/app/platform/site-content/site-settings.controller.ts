import { Body, Controller, Get, Put } from '@nestjs/common';
import type { SiteSettings } from '@pharmacy/shared-dto';
import { RequireFreshAuth } from '../../../common/guards/decorators';
import { RequireOperatorPermission } from '../auth/decorators';
import { UpdateSiteSettingsDto } from './dto/site-settings.dto';
import { SiteSettingsService } from './site-settings.service';

// The settings of the public site (spec 2026-10-28-public-site-design, 6.2): «Сайт → Настройки» of the admin.
// Changing them needs a recent sign-in: the contacts and the name are shown to every visitor of the site.
@Controller({ path: 'operator/site-settings', version: '1' })
export class SiteSettingsController {
  constructor(private readonly settings: SiteSettingsService) {}

  @RequireOperatorPermission('content:manage')
  @Get()
  get(): Promise<SiteSettings> {
    return this.settings.get();
  }

  /** 400 `validation_failed`, 400 `media_not_found`; 403 `fresh_auth_required`. */
  @RequireOperatorPermission('content:manage')
  @RequireFreshAuth()
  @Put()
  update(@Body() body: UpdateSiteSettingsDto): Promise<SiteSettings> {
    return this.settings.update(body);
  }
}
