import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  databaseSettings,
  TENANT_DATABASE_SETTINGS,
} from './database-settings';
import { TenantDatabase } from './tenant-database';

// Tenant data path for every domain module (ADR-0006). Global, exports TenantDatabase only:
// the settings, the pool and the root Kysely stay inside.
@Global()
@Module({
  providers: [
    {
      provide: TENANT_DATABASE_SETTINGS,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        databaseSettings(config, {
          url: 'DATABASE_URL',
          poolMax: 'DB_POOL_MAX',
        }),
    },
    TenantDatabase,
  ],
  exports: [TenantDatabase],
})
export class DatabaseModule {}
