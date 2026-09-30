# NestJS Enterprise Patterns — исключения, RFC 7807, валидация, версионирование

Все ошибки API — `application/problem+json` по RFC 7807 (RFC 9457 — совместимый преемник,
формат тот же). Один глобальный фильтр; контроллеры и сервисы бросают исключения, а не
формируют ответы об ошибках сами.

## Контракт Problem Details (libs/shared/dto/src/problem.ts)

```typescript
export interface ProblemDetails {
  type: string;          // stable URI of the problem kind, e.g. 'urn:pharmacy:problem:insufficient-stock'
  title: string;         // short, human-readable, not localized per request
  status: number;
  detail?: string;       // safe for the client: no SQL, no stack, no PII
  instance?: string;     // request path
  code?: string;         // machine-readable, e.g. 'INSUFFICIENT_STOCK' — web/admin localize by code (RU/TJ)
  correlationId: string; // always present — the cashier reads it to support
  errors?: Array<{ field: string; messages: string[] }>; // validation only
}
```

Константы `type`/`code` живут в `libs/shared/dto` — фронтенды переводят сообщение по `code`.

## Иерархия исключений

```typescript
// apps/api/src/common/exceptions/domain.exceptions.ts
import { HttpStatus } from '@nestjs/common';

export abstract class DomainException extends Error {
  protected constructor(
    readonly code: string,
    readonly status: HttpStatus,
    message: string,
    readonly meta?: Record<string, string | number>, // ids only, never PII
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ResourceNotFoundException extends DomainException {
  constructor(resource: string, id: string) {
    super('RESOURCE_NOT_FOUND', HttpStatus.NOT_FOUND, `${resource} not found`, { resource, id });
  }
}

/** Business rule violation: request is well-formed but not allowed right now */
export class BusinessRuleException extends DomainException {
  constructor(code: string, message: string, meta?: Record<string, string | number>) {
    super(code, HttpStatus.UNPROCESSABLE_ENTITY, message, meta);
  }
}

export class InsufficientStockException extends BusinessRuleException {
  constructor(batchId: string) {
    super('INSUFFICIENT_STOCK', 'Not enough stock in batch', { batchId });
  }
}

export class IdempotencyConflictException extends DomainException {
  constructor() {
    super('IDEMPOTENCY_KEY_REUSED', HttpStatus.CONFLICT, 'Idempotency key was used with a different payload');
  }
}
```

```typescript
// apps/api/src/common/exceptions/static-configuration.exception.ts — used by the config reader
export class StaticConfigurationException extends Error {
  static missingEnvVar(key: string): StaticConfigurationException {
    return new StaticConfigurationException(`Missing required environment variable: ${key}`);
  }
  static invalidEnvVar(key: string, value: string, expected: string): StaticConfigurationException {
    const shown = /PASSWORD|SECRET|KEY|TOKEN|DATABASE_URL/i.test(key) ? '<redacted>' : value;
    return new StaticConfigurationException(`Invalid ${key}="${shown}". Expected: ${expected}`);
  }
}
```

## Глобальный фильтр (apps/api/src/common/filters/problem-details.filter.ts)

```typescript
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ProblemDetails } from '@pharmacy/shared/dto';
import { DomainException } from '../exceptions/domain.exceptions';
import { getCorrelationId } from '../context/request-context';
import { pgErrorCode, PG_CHECK_VIOLATION, PG_FOREIGN_KEY_VIOLATION, PG_UNIQUE_VIOLATION } from '../../core/database/pg-errors';

const urn = (slug: string) => `urn:pharmacy:problem:${slug}`;

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const req = host.switchToHttp().getRequest<Request>();
    const res = host.switchToHttp().getResponse<Response>();
    const problem = this.toProblem(exception, req.path, getCorrelationId() ?? 'unknown');

    if (problem.status >= 500) {
      this.logger.error(`${req.method} ${req.path} -> ${problem.status}`, exception instanceof Error ? exception.stack : undefined);
    } else {
      this.logger.warn(`${req.method} ${req.path} -> ${problem.status} ${problem.code ?? ''}`);
    }

    res.status(problem.status).type('application/problem+json').json(problem);
  }

  private toProblem(ex: unknown, instance: string, correlationId: string): ProblemDetails {
    if (ex instanceof DomainException) {
      return { type: urn(ex.code.toLowerCase().replace(/_/g, '-')), title: ex.message, status: ex.status, code: ex.code, instance, correlationId };
    }

    const pg = pgErrorCode(ex);
    if (pg === PG_UNIQUE_VIOLATION || pg === PG_FOREIGN_KEY_VIOLATION) {
      // never leak constraint names or values into detail
      return { type: urn('conflict'), title: 'Conflict', status: HttpStatus.CONFLICT, code: 'CONFLICT', instance, correlationId };
    }
    if (pg === PG_CHECK_VIOLATION) {
      return { type: urn('constraint-violation'), title: 'Constraint violation', status: HttpStatus.UNPROCESSABLE_ENTITY, code: 'CONSTRAINT_VIOLATION', instance, correlationId };
    }

    if (ex instanceof HttpException) {
      const status = ex.getStatus();
      const body = ex.getResponse();
      const messages = typeof body === 'object' && body !== null ? (body as { message?: unknown }).message : undefined;
      if (status === HttpStatus.BAD_REQUEST && Array.isArray(messages)) {
        return { type: urn('validation'), title: 'Validation failed', status, code: 'VALIDATION_FAILED', instance, correlationId, errors: [{ field: '*', messages: messages.map(String) }] };
      }
      return { type: 'about:blank', title: ex.message, status, instance, correlationId };
    }

    return { type: 'about:blank', title: 'Internal Server Error', status: HttpStatus.INTERNAL_SERVER_ERROR, instance, correlationId };
  }
}
```

Для поштучных ошибок полей вместо плоского списка сообщений задайте в `ValidationPipe`
`exceptionFactory`, которая соберёт `errors[]` по `ValidationError.property`
(с рекурсией по `children` для строк чека).

## Коды статуса

| Ситуация | Статус | Источник |
|---|---|---|
| DTO не прошёл валидацию | 400 | `ValidationPipe` |
| Нет/истекла сессия | 401 | `SessionAuthGuard` |
| Нет права «модуль × действие» или точки вне охвата | 403 | `PermissionsGuard` |
| Ресурс не найден **в тенанте** (чужой тенант — тоже 404, не 403) | 404 | `ResourceNotFoundException` |
| Дубликат / unique violation / повтор idempotency key с другим телом | 409 | pg `23505`, `IdempotencyConflictException` |
| Нарушение бизнес-правила (нет остатка, смена закрыта, ПКУ без рецепта) | 422 | `BusinessRuleException` |
| Лимит запросов | 429 | throttler |
| Внешняя интеграция недоступна (фискализация, синхронизация) | 502/503 | клиент интеграции |

## ValidationPipe

Конфигурация — в `APP_PIPE` (`nestjs-templates-core.md`): `whitelist`, `forbidNonWhitelisted`,
`transform`, `forbidUnknownValues`, `validationError: { target: false, value: false }` —
значения полей в ответ не возвращаются (могут содержать ПДн).

## Версионирование API

URI-версионирование: `app.setGlobalPrefix('api')` + `enableVersioning({ type: VersioningType.URI, defaultVersion: '1' })`.

```typescript
@Controller({ path: 'receipts', version: '1' })   // /api/v1/receipts
export class ReceiptsController {}

@Controller({ path: 'health', version: VERSION_NEUTRAL }) // /api/health
export class HealthController {}
```

`v2` заводится только при несовместимом изменении контракта; офлайн-точки могут работать
на старой версии до обновления — облачный api обязан обслуживать версию, с которой
синхронизируются точки, пока они не обновлены.
