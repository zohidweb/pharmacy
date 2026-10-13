import { randomUUID } from 'node:crypto';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

export const CORRELATION_ID_HEADER = 'X-Correlation-Id';

// Letters, digits and hyphens only: safe to echo in a header and to write to logs.
const CORRELATION_ID = /^[A-Za-z0-9-]{8,64}$/;

/** The client's X-Correlation-Id when it is well formed, otherwise null. */
export function incomingCorrelationId(req: Request): string | null {
  const incoming: unknown = req.headers?.['x-correlation-id'];
  return typeof incoming === 'string' && CORRELATION_ID.test(incoming)
    ? incoming
    : null;
}

// Accepts a well-formed X-Correlation-Id from the client (to trace a request across the web app,
// the API and an offline store), otherwise issues a random UUID; echoes it in the response.
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const correlationId = incomingCorrelationId(req) ?? randomUUID();
    req.correlationId = correlationId;
    res.setHeader(CORRELATION_ID_HEADER, correlationId);
    next();
  }
}
