import { Logger, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app/app.module';
import { createValidationPipe } from './common/validation/validation-pipe';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // `trust proxy` is deliberately not set: req.ip (the guest throttling key and the login
  // limiter) is the socket address until the reverse proxy is chosen (ADR-0012, proposed), which
  // decides how many hops to trust. Setting it blindly would let a client spoof X-Forwarded-For.
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
