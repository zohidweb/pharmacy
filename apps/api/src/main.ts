import { Logger, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { importLimits } from '@pharmacy/shared-domain';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { AppModule } from './app/app.module';
import {
  isImportPath,
  isSiteMediaUploadPath,
  isSiteTextSavePath,
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
  // 2026-10-20-data-import, F19), every other route keeps the default 100 KB. A body is parsed before the guards
  // (security review 2026-10-22, A3), so a larger one is read only:
  // - for a load, with a genuine session token (signature and expiry; the session record and the permission are
  //   checked by SessionMiddleware and the guards after the parse, as for every route);
  // - for a sync batch, with a well-formed license key and only while the sync contour is on (OFFLINE_SYNC_ENABLED,
  //   off in the pilot, decision 7.4) — the key is verified by its guard after the parse.
  // Only the sync contour inflates a compressed body: the web clients never compress one. No form bodies: CsrfGuard
  // refuses every unsafe request that is not JSON.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  const config = app.get(ConfigService);
  // First, so that the answers of the body parsers (413, 415) carry the security headers too. HSTS comes from the
  // reverse proxy, only where it terminates TLS (ADR-0012): sent here too, it would also reach the offline store over
  // plain http://localhost and duplicate the header of the proxy.
  app.use(helmet({ strictTransportSecurity: false }));
  // No API answer is stored by the browser: they carry personal and prescription data, and pharmacy PCs are shared
  // (security review 2026-10-22, P1). No ETag either — nothing is revalidated.
  app.set('etag', false);
  // Every answer keeps this by default; the one image the public media route sends overrides it itself (ADR-0023, P3),
  // so a 404 or 429 of that route is not stored.
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
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
  if (config.get<boolean>('OFFLINE_SYNC_ENABLED', false)) {
    app.useBodyParser('json', {
      limit: SYNC_BODY_LIMIT,
      type: (req: BodyRequest) =>
        isSyncPath(req.originalUrl ?? req.url) &&
        licenseKeyIdOf(req.headers.authorization) !== null &&
        isJson(req),
    });
  }
  app.useBodyParser('json', {
    limit: importLimits.bodyBytes,
    inflate: false,
    type: (req: BodyRequest) => {
      if (!isImportPath(req.originalUrl ?? req.url) || !isJson(req))
        return false;
      const token = extractor.extract(req);
      return token !== null && tokens.verifyNow(token, 'web') !== null;
    },
  });
  // The upload of a site image — a JSON body with base64, up to 3 MiB (ADR-0023, P16), only with a genuine operator
  // token (signature and expiry; the session record and the permission are checked after the parse).
  app.useBodyParser('json', {
    limit: 3 * 1024 * 1024,
    inflate: false,
    type: (req: BodyRequest) => {
      if (!isSiteMediaUploadPath(req.originalUrl ?? req.url) || !isJson(req))
        return false;
      const token = extractor.extractOperator(req);
      return token !== null && tokens.verifyOperatorNow(token) !== null;
    },
  });
  // The save of an article or of a draft of a legal document — up to 1 MiB (the texts are long), same condition.
  app.useBodyParser('json', {
    limit: 1024 * 1024,
    inflate: false,
    type: (req: BodyRequest) => {
      if (!isSiteTextSavePath(req.originalUrl ?? req.url) || !isJson(req))
        return false;
      const token = extractor.extractOperator(req);
      return token !== null && tokens.verifyOperatorNow(token) !== null;
    },
  });
  app.useBodyParser('json', { inflate: false });

  // req.ip (the guest/login/activation throttling keys, the audit `ip`) is the socket address
  // unless TRUST_PROXY (hop count of the reverse proxy, default 0 = off) says how many proxies to
  // trust. It is a deploy prerequisite behind the reverse proxy of ADR-0012: a wrong hop count lets
  // a client spoof X-Forwarded-For (too high) or merges all clients into one bucket (too low).
  const trustProxy = config.get<number>('TRUST_PROXY', 0);
  if (trustProxy > 0) app.set('trust proxy', trustProxy);

  // REST: /api/v1/... (CLAUDE.md, "Conventions").
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(createValidationPipe());
  app.enableShutdownHooks();

  const port = config.get<number>('PORT', 3000);
  await app.listen(port);
  Logger.log(`API is running on http://localhost:${port}/api/v1`, 'Bootstrap');
}

bootstrap();
