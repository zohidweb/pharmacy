import { Inject, Injectable } from '@nestjs/common';
import {
  PUBLIC_SITE_DATABASE_SETTINGS,
  type DatabaseSettings,
} from '../database-settings';
import { PlatformDatabase } from './platform-database';

// The reads of the public contour of the site (ADR-0023, ruling R8): the same role pharmacy_platform and the same
// rules as PlatformDatabase, but a pool of its own (PUBLIC_DB_POOL_MAX, `application_name` api-public-site), so a burst
// of anonymous reads never takes the few connections of the operator admin. Only the public read services of
// app/platform/site-content use it; the connection request form writes through PlatformDatabase.
@Injectable()
export class PublicSiteDatabase extends PlatformDatabase {
  constructor(
    @Inject(PUBLIC_SITE_DATABASE_SETTINGS) settings: DatabaseSettings,
  ) {
    super(settings);
  }
}
