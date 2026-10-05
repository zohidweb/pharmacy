import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  databaseSettings,
  TENANT_DATABASE_SETTINGS,
} from './database-settings';
import { ContextResolvers } from './context-resolvers';
import { TenantDatabase } from './tenant-database';

// Tenant data path for every domain module (ADR-0006). Global, exports TenantDatabase and the
// pre-context resolvers (ADR-0013 p. 3): the settings, the pools and the root Kysely stay inside.
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
    ContextResolvers,
  ],
  exports: [TenantDatabase, ContextResolvers],
})
export class DatabaseModule {}
