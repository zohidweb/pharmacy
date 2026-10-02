import { randomUUID } from 'node:crypto';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

export const CORRELATION_ID_HEADER = 'X-Correlation-Id';

// Letters, digits and hyphens only: safe to echo in a header and to write to logs.
const CORRELATION_ID = /^[A-Za-z0-9-]{8,64}$/;

// Accepts a well-formed X-Correlation-Id from the client (to trace a request across the web app,
// the API and an offline store), otherwise issues a random UUID; echoes it in the response.
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.headers['x-correlation-id'];
    const correlationId =
      typeof incoming === 'string' && CORRELATION_ID.test(incoming)
        ? incoming
        : randomUUID();
    req.correlationId = correlationId;
    res.setHeader(CORRELATION_ID_HEADER, correlationId);
    next();
  }
}
