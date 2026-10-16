import { Logger, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app/app.module';
import { isSyncPath } from './common/http/contour';
import { createValidationPipe } from './common/validation/validation-pipe';
import { SYNC_BODY_LIMIT } from './core/sync/protocol';

async function bootstrap() {
  // The body parsers are registered by hand: the sync contour of offline stores takes a batch of up to 2 MB of
  // JSON after gzip is inflated (ADR-0014 §6), every other route keeps the default 100 KB.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  app.useBodyParser('json', {
    limit: SYNC_BODY_LIMIT,
    type: (req: {
      originalUrl?: string;
      url?: string;
      headers: Record<string, unknown>;
    }) =>
      isSyncPath(req.originalUrl ?? req.url) &&
      String(req.headers['content-type'] ?? '')
        .split(';')[0]
        .trim()
        .toLowerCase() === 'application/json',
  });
  app.useBodyParser('json');
  app.useBodyParser('urlencoded', { extended: true });

  // req.ip (the guest/login/activation throttling keys, the audit `ip`) is the socket address
  // unless TRUST_PROXY (hop count of the reverse proxy, default 0 = off) says how many proxies to
  // trust. It is a deploy prerequisite behind the reverse proxy of ADR-0012: a wrong hop count lets
  // a client spoof X-Forwarded-For (too high) or merges all clients into one bucket (too low).
  const trustProxy = app.get(ConfigService).get<number>('TRUST_PROXY', 0);
  if (trustProxy > 0) app.set('trust proxy', trustProxy);

  app.use(helmet());
  // Fills req.cookies for the session middleware (the session JWT travels in a cookie, ADR-0008).
  app.use(cookieParser());

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
