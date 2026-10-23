import { createHash, timingSafeEqual } from 'node:crypto';
import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { sql } from 'kysely';
import { ProblemException } from '../../common/errors/problem.exception';
import { licenseKeyIdOf } from '../../common/http/contour';
import {
  ContextResolvers,
  TenantDatabase,
  type TenantTransaction,
} from '../../core/database';
import { licenseState } from './license-status';
import type { SyncRequest, SyncSettings } from './sync-store.context';

export const LICENSE_STATUS_HEADER = 'Pharmacy-License-Status';

// The secret part of phk_<keyId>_<secret>: 32 random bytes in base64url.
const SECRET = /^Bearer phk_[0-9a-f]{16}_([A-Za-z0-9_-]{43})$/;

// Authentication of an offline store on the sync contour (ADR-0014 §6–7; spec 2026-10-16-offline-sync, E10, E12):
// the open key id finds the key through the resolver, SHA-256 of the secret is compared in constant time, and
// the store, its network and the license state go to the request. The key, the secret and its hash never reach
// logs or answers. revoked_hard — 401; every other state passes, the services decide what it may do.
@Injectable()
export class LicenseKeyGuard implements CanActivate {
  constructor(
    private readonly resolvers: ContextResolvers,
    private readonly db: TenantDatabase,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & SyncRequest>();
    const res = context.switchToHttp().getResponse<Response>();
    const authorization = req.headers.authorization;
    const keyId = licenseKeyIdOf(authorization);
    const secret = SECRET.exec(authorization ?? '')?.[1];
    if (!keyId || !secret) throw new ProblemException(401, 'license_invalid');

    const key = await this.resolvers.resolveLicenseKey(keyId);
    const presented = createHash('sha256').update(secret, 'utf8').digest();
    // Compare even when nothing was found, so the answer time does not tell a known key id.
    const stored = key?.keyHash ?? Buffer.alloc(presented.length);
    const matches =
      stored.length === presented.length && timingSafeEqual(stored, presented);
    if (!key || !matches) throw new ProblemException(401, 'license_invalid');

    const settings = await this.db.withTenant(key.tenantId, (trx) =>
      readSyncSettings(trx),
    );
    const license = licenseState(key, new Date(), settings.revokedKeyGraceDays);
    res.setHeader(LICENSE_STATUS_HEADER, license.status);
    if (license.status === 'revoked_hard') {
      throw new ProblemException(401, 'license_revoked');
    }
    const bodyStore = (req.body as { storeId?: unknown } | undefined)?.storeId;
    if (bodyStore !== undefined && bodyStore !== key.storeId) {
      throw new ProblemException(403, 'store_mismatch');
    }
    req.syncStore = {
      tenantId: key.tenantId,
      storeId: key.storeId,
      keyId,
      storeMode: key.storeMode,
      license,
      settings,
    };
    return true;
  }
}

/** The platform settings of the sync contour (E13); the values of the migration without the row. */
export async function readSyncSettings(
  trx: TenantTransaction,
): Promise<SyncSettings> {
  const { rows } = await sql<SyncSettings>`
    select feed_window_days, revoked_key_grace_days, min_supported_protocol, recommended_protocol
    from pharmacy.platform_settings where id = 1`.execute(trx);
  return (
    rows[0] ?? {
      feedWindowDays: 90,
      revokedKeyGraceDays: 30,
      minSupportedProtocol: 1,
      recommendedProtocol: 1,
    }
  );
}
