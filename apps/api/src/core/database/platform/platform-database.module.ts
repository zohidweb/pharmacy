import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  databaseSettings,
  PLATFORM_DATABASE_SETTINGS,
} from '../database-settings';
import { PlatformDatabase } from './platform-database';

// Cross-tenant data path (ADR-0013 p. 7). Deliberately not @Global: imported only by modules of
// app/platform/** and by sync on the offline store.
@Module({
  providers: [
    {
      provide: PLATFORM_DATABASE_SETTINGS,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        databaseSettings(config, {
          url: 'PLATFORM_DATABASE_URL',
          poolMax: 'PLATFORM_DB_POOL_MAX',
        }),
    },
    PlatformDatabase,
  ],
  exports: [PlatformDatabase],
})
export class PlatformDatabaseModule {}
