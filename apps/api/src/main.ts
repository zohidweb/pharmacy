import { Logger, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { importLimits } from '@pharmacy/shared-domain';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app/app.module';
import {
  isImportPath,
  isSyncPath,
  licenseKeyIdOf,
} from './common/http/contour';
import { TokenExtractor } from './common/middleware/token-extractor';
import { createValidationPipe } from './common/validation/validation-pipe';
import { SessionTokenService } from './core/crypto/session-token.service';
import { SYNC_BODY_LIMIT } from './core/sync/protocol';

async function bootstrap() {
  // The body parsers are registered by hand: the sync contour of offline stores takes a batch of up to 2 MB of
  // JSON after gzip is inflated (ADR-0014 §6), the loads of data from a file — up to 10 MB of rows (spec
  // 2026-10-20-data-import, F19), every other route keeps the default 100 KB. A body is parsed before the guards, so
  // nothing larger than 100 KB is read for a request that cannot pass them, and only the sync contour inflates a
  // compressed body — the web clients never compress one (security review 2026-10-22, A3). No form bodies: CsrfGuard
  // refuses every unsafe request that is not JSON.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  // Before the body parsers: the parser of the loads reads the session token from the cookie.
  app.use(cookieParser());
  const extractor = app.get(TokenExtractor);
  const tokens = app.get(SessionTokenService);
  type BodyRequest = Parameters<TokenExtractor['extract']>[0];
  const isJson = (req: BodyRequest): boolean =>
    String(req.headers['content-type'] ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase() === 'application/json';
  app.useBodyParser('json', {
    limit: SYNC_BODY_LIMIT,
    // a store's batch only: a well-formed license key (the guard verifies it after the parse)
    type: (req: BodyRequest) =>
      isSyncPath(req.originalUrl ?? req.url) &&
      licenseKeyIdOf(req.headers.authorization) !== null &&
      isJson(req),
  });
  app.useBodyParser('json', {
    limit: importLimits.bodyBytes,
    inflate: false,
    // a load only with a genuine session token (signature and expiry); the session record and the permission are
    // checked by SessionMiddleware and the guards, as for every route
    type: (req: BodyRequest) => {
      if (!isImportPath(req.originalUrl ?? req.url) || !isJson(req))
        return false;
      const token = extractor.extract(req);
      return token !== null && tokens.verifyNow(token, 'web') !== null;
    },
  });
  app.useBodyParser('json', { inflate: false });

  // req.ip (the guest/login/activation throttling keys, the audit `ip`) is the socket address
  // unless TRUST_PROXY (hop count of the reverse proxy, default 0 = off) says how many proxies to
  // trust. It is a deploy prerequisite behind the reverse proxy of ADR-0012: a wrong hop count lets
  // a client spoof X-Forwarded-For (too high) or merges all clients into one bucket (too low).
  const trustProxy = app.get(ConfigService).get<number>('TRUST_PROXY', 0);
  if (trustProxy > 0) app.set('trust proxy', trustProxy);

  app.use(helmet());

  // REST: /api/v1/... (CLAUDE.md, "Conventions").
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(createValidationPipe());
  app.enableShutdownHooks();

  const port = app.get(ConfigService).get<number>('PORT', 3000);
  await app.listen(port);
  Logger.log(`API is running on http://localhost:${port}/api/v1`, 'Bootstrap');
}

bootstrap();
