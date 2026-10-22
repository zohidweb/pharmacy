import { randomUUID } from 'node:crypto';
import {
  type ArgumentsHost,
  BadRequestException,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  getRequestContext,
  UnauthenticatedError,
} from '../context/request-context';
import { LockedException, ProblemException } from '../errors/problem.exception';
import { isSyncPath, licenseKeyIdOf } from '../http/contour';
import {
  CORRELATION_ID_HEADER,
  incomingCorrelationId,
} from '../middleware/correlation-id.middleware';
import {
  FieldProblemException,
  type FieldError,
  ValidationFailedException,
} from '../errors/validation-failed.exception';

// RFC 7807 body. `code` is the machine-readable part (auth design 2026-10-02, section 11).
interface ProblemBody {
  type: 'about:blank';
  title: string;
  status: number;
  code: string;
  detail?: string;
  /** Rejected fields of a validation_failed or a field-level 422 (ADR-0015); paths and codes only. */
  errors?: readonly FieldError[];
  correlationId: string;
}

const PROBLEM_CONTENT_TYPE = 'application/problem+json';

// Title and default code per status. Fixed texts only: the message of a framework exception can
// echo the client's input (a path, a JSON fragment, a rejected value), so it is never copied.
const BY_STATUS: Readonly<Record<number, { title: string; code: string }>> = {
  400: { title: 'Bad Request', code: 'bad_request' },
  401: { title: 'Unauthorized', code: 'unauthenticated' },
  403: { title: 'Forbidden', code: 'forbidden' },
  404: { title: 'Not Found', code: 'not_found' },
  405: { title: 'Method Not Allowed', code: 'method_not_allowed' },
  406: { title: 'Not Acceptable', code: 'not_acceptable' },
  409: { title: 'Conflict', code: 'conflict' },
  413: { title: 'Payload Too Large', code: 'payload_too_large' },
  415: { title: 'Unsupported Media Type', code: 'unsupported_media_type' },
  422: { title: 'Unprocessable Entity', code: 'unprocessable_entity' },
  429: { title: 'Too Many Requests', code: 'too_many_requests' },
  503: { title: 'Service Unavailable', code: 'service_unavailable' },
};

const INTERNAL: { title: string; code: string } = {
  title: 'Internal Server Error',
  code: 'internal_error',
};

function describeStatus(status: number): { title: string; code: string } {
  const known = BY_STATUS[status];
  if (known) return known;
  if (status >= 500) return { title: 'Server Error', code: 'server_error' };
  return { title: 'Request Error', code: 'request_error' };
}

// A 4xx error that is not a Nest HttpException but carries a status, such as the errors body-parser
// passes to next() (payload too large, unsupported charset). Anything else is an unknown error.
function clientErrorStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const { status, statusCode } = error as {
    status?: unknown;
    statusCode?: unknown;
  };
  const value = typeof status === 'number' ? status : statusCode;
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 400 &&
    value < 500
    ? value
    : null;
}

// Only the "at ..." frames of a stack: the first line repeats the message, which can hold values
// (a connection string, a row). The database error code, when there is one, helps diagnosis.
function safeTrace(error: unknown): string {
  if (!(error instanceof Error)) return '';
  const frames = (error.stack ?? '')
    .split('\n')
    .filter((line) => line.trimStart().startsWith('at '))
    .join('\n');
  const code = (error as { code?: unknown }).code;
  const suffix =
    typeof code === 'string' && /^[A-Z0-9_]{1,32}$/.test(code)
      ? ` (code ${code})`
      : '';
  return `${suffix}\n${frames}`;
}

// Global exception filter: every error leaves the API as application/problem+json with the
// correlation id (RFC 7807, CLAUDE.md "Conventions"). Never echoes the client's input, never sends a
// stack trace; an unknown error is a generic 500 and is logged with its correlation id.
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(error: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const known = req?.correlationId ?? getRequestContext()?.correlationId;
    // Before the middleware ran, the client's own well-formed id is kept, as the middleware would.
    const correlationId =
      known ?? (req ? incomingCorrelationId(req) : null) ?? randomUUID();

    const body = this.toBody(error, correlationId);
    // A batch of an offline store over the body limit of the sync contour (ADR-0014 §6): only a request with a
    // well-formed key is a batch — any other one is told nothing about batches (security review 2026-10-22, A3).
    if (
      body.status === 413 &&
      isSyncPath(req?.originalUrl) &&
      licenseKeyIdOf(req?.headers?.authorization) !== null
    ) {
      body.code = 'batch_too_large';
    }
    if (res.headersSent) return;
    // An error before the correlation middleware ran (a body the parser refused, a path outside
    // /api): the header carries the id of the body too, as on every other answer. Debug only: any
    // stray path of a scanner lands here.
    if (known === undefined) {
      res.setHeader(CORRELATION_ID_HEADER, correlationId);
      this.logger.debug(
        `Request refused before routing (${body.status}) [correlationId=${correlationId}]`,
      );
    }
    if (error instanceof LockedException) {
      res.setHeader(
        'Retry-After',
        String(Math.max(1, Math.ceil(error.retryAfterSeconds))),
      );
    }
    res
      .status(body.status)
      .setHeader('Content-Type', PROBLEM_CONTENT_TYPE)
      .send(JSON.stringify(body));
  }

  private toBody(error: unknown, correlationId: string): ProblemBody {
    if (error instanceof ProblemException) {
      const status = error.getStatus();
      const body: ProblemBody = {
        type: 'about:blank',
        title: describeStatus(status).title,
        status,
        code: error.code,
        correlationId,
      };
      if (error.detail !== undefined) body.detail = error.detail;
      if (error instanceof FieldProblemException) body.errors = error.errors;
      if (error instanceof ValidationFailedException) {
        body.title = 'Validation Failed';
      }
      this.logServerError(status, error, correlationId);
      return body;
    }

    if (error instanceof UnauthenticatedError) {
      return problem(401, 'unauthenticated', correlationId);
    }

    if (error instanceof BadRequestException) {
      // A default-pipe validation failure (the message is a list of rule texts; the app's own pipe throws
      // ValidationFailedException with errors[], handled above) and a malformed body alike:
      // the texts name the rejected properties, so none is sent.
      const response = error.getResponse();
      const validation =
        typeof response === 'object' &&
        response !== null &&
        Array.isArray((response as { message?: unknown }).message);
      return validation
        ? {
            type: 'about:blank',
            title: 'Validation Failed',
            status: 400,
            code: 'validation_failed',
            errors: [],
            correlationId,
          }
        : problem(400, 'bad_request', correlationId);
    }

    if (error instanceof HttpException) {
      const status = error.getStatus();
      this.logServerError(status, error, correlationId);
      const { code } = describeStatus(status);
      return problem(status, code, correlationId);
    }

    const clientStatus = clientErrorStatus(error);
    if (clientStatus !== null) {
      return problem(
        clientStatus,
        describeStatus(clientStatus).code,
        correlationId,
      );
    }

    // Name and frames only: the message may carry values from the database or the network.
    const name = error instanceof Error ? error.name : typeof error;
    this.logger.error(
      `Unhandled ${name} [correlationId=${correlationId}]${safeTrace(error)}`,
    );
    return {
      type: 'about:blank',
      title: INTERNAL.title,
      status: 500,
      code: INTERNAL.code,
      correlationId,
    };
  }

  private logServerError(
    status: number,
    error: Error,
    correlationId: string,
  ): void {
    if (status >= 500) {
      this.logger.warn(
        `${error.name} ${status} [correlationId=${correlationId}]`,
      );
    }
  }
}

function problem(
  status: number,
  code: string,
  correlationId: string,
): ProblemBody {
  return {
    type: 'about:blank',
    title: describeStatus(status).title,
    status,
    code,
    correlationId,
  };
}
