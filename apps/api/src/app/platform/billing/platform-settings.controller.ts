import { Body, Controller, Get, Put } from '@nestjs/common';
import type { PlatformSettings } from '@pharmacy/shared-dto';
import { RequireFreshAuth } from '../../../common/guards/decorators';
import { RequireOperatorPermission } from '../auth/decorators';
import { UpdatePlatformSettingsDto } from './dto/billing.dto';
import { PlatformSettingsService } from './platform-settings.service';

// The platform settings (spec 2026-10-15-billing-services, 6.1): the tariff, the VAT rate and the
// requisites. Changing them needs a recent sign-in: they set the money of every next invoice.
@Controller({ path: 'operator/settings', version: '1' })
export class PlatformSettingsController {
  constructor(private readonly settings: PlatformSettingsService) {}

  @RequireOperatorPermission('platform:view')
  @Get()
  get(): Promise<PlatformSettings> {
    return this.settings.get();
  }

  /** 400, 403 `fresh_auth_required`. */
  @RequireOperatorPermission('platform:manage')
  @RequireFreshAuth()
  @Put()
  update(@Body() body: UpdatePlatformSettingsDto): Promise<PlatformSettings> {
    return this.settings.update(body);
  }
}
