import { Body, Controller, Get, Put } from '@nestjs/common';
import type { NetworkSettings } from '@pharmacy/shared-dto';
import { RequireFreshAuth } from '../../common/guards/decorators';
import { RequirePermission } from '../auth/decorators';
import { UpdateNetworkSettingsDto } from './dto/settings.dto';
import { SettingsService } from './settings.service';

// The network settings of the owner cabinet (spec 2026-10-14-owner-cabinet, 5.1, E14).
@Controller({ path: 'settings', version: '1' })
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @RequirePermission('settings:view')
  @Get()
  get(): Promise<NetworkSettings> {
    return this.settings.get();
  }

  /**
   * The session timeout and the PIN length are security settings: 403 `fresh_auth_required`
   * without a fresh sign-in; 400 `validation_failed` out of the ranges.
   */
  @RequirePermission('settings:update')
  @RequireFreshAuth()
  @Put()
  update(@Body() body: UpdateNetworkSettingsDto): Promise<NetworkSettings> {
    return this.settings.update(body);
  }
}
