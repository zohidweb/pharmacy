import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  databaseSettings,
  PUBLIC_SITE_DATABASE_SETTINGS,
} from '../database-settings';
import { PublicSiteDatabase } from './public-site-database';

// The pool of the public reads of the site (ADR-0023, ruling R8): a sibling of PlatformDatabaseModule with the same
// PLATFORM_DATABASE_URL and its own size. Imported only by app/platform/site-content.
@Module({
  providers: [
    {
      provide: PUBLIC_SITE_DATABASE_SETTINGS,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        ...databaseSettings(config, {
          url: 'PLATFORM_DATABASE_URL',
          poolMax: 'PUBLIC_DB_POOL_MAX',
        }),
        applicationName: 'api-public-site',
      }),
    },
    PublicSiteDatabase,
  ],
  exports: [PublicSiteDatabase],
})
export class PublicSiteDatabaseModule {}
