# NestJS Security — аутентификация и авторизация Pharmacy

Аутентификация **самописная, согласована с ИБ** (APPROVAL.md): логин + пароль (хеш), PIN
≥ 4 цифр для переключения кассира на привязанном терминале, **серверные сессии в Redis**,
таймаут сессии — настройка сети тенанта. Права — «модуль × действие × охват точек»
(базовые и кастомные роли). JWT, OAuth/SSO-провайдеры, Passport-стратегии — не стандарт
проекта; вводятся только через ADR.

> **Требует ADR + согласования ИБ до реализации:**
> - библиотека/алгоритм хеширования паролей и PIN (категория радара «Криптография
>   (библиотеки)» на утверждении; кандидаты — Argon2id, scrypt из `node:crypto`, bcrypt);
> - транспорт идентификатора сессии (HttpOnly-cookie или заголовок) и защита от CSRF;
> - протокол привязки терминала к точке;
> - механика входа оператора платформы «от имени» тенанта.
>
> Самописная криптография запрещена: только стандартные примитивы рантайма
> (`crypto.randomBytes`, `createHash('sha256')`) и утверждённая библиотека хеширования.

## Модель

| Сущность | Ключевые поля |
|---|---|
| `employees` | `tenant_id`, `login` (уникален в тенанте), `password_hash`, `pin_hash`, `status`, `role_id` |
| `roles` | `tenant_id` (NULL — базовая роль платформы), `name`, `version` |
| `role_permissions` | `role_id`, `module` (`pos`, `inventory`…), `action` (`read`, `sell`, `post`…) |
| `employee_store_scopes` | `employee_id`, `store_id` или признак «все точки сети» |
| `terminals` | `tenant_id`, `store_id`, `credential_hash`, `revoked_at` |

## Хеширование — порт, реализация по ADR

```typescript
// apps/api/src/auth/password-hasher.port.ts
export interface PasswordHasher {
  hash(secret: string): Promise<string>;                          // self-describing format (alg + params + salt)
  verify(secret: string, storedHash: string): Promise<boolean>;   // constant-time inside the library
  needsRehash(storedHash: string): boolean;                       // parameter upgrades on next login
}
export const PASSWORD_HASHER = Symbol('PASSWORD_HASHER');
```

Реализацию (`Argon2PasswordHasher`, `ScryptPasswordHasher`…) добавлять только после ADR.
PIN хешируется тем же хешером; из-за малой энтропии PIN главная защита — блокировка после
`PIN_MAX_ATTEMPTS` неудач.

## Сессии в Redis

```typescript
// apps/api/src/auth/session.store.ts
import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { RedisService } from '../core/redis/redis.service';

export interface SessionData {
  tenantId: string;
  employeeId: string;
  roleId: string;
  roleVersion: number;          // permissions are reloaded when the role changes
  storeScope: 'all' | string[]; // store ids the employee may act on
  terminalId?: string;          // PIN session on a bound terminal: scope = the terminal's store
  actingOperatorId?: string;    // platform operator "on behalf of" (ADR)
  createdAt: number;
  absoluteExpiresAt: number;
}

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
const sessionKey = (token: string) => `sess:${sha256(token)}`; // raw token is never stored
const indexKey = (tenantId: string, employeeId: string) => `sess-idx:${tenantId}:${employeeId}`;

@Injectable()
export class SessionStore {
  constructor(private readonly redis: RedisService) {}

  async create(data: SessionData, idleTtlSeconds: number): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.redis.multi()
      .set(sessionKey(token), JSON.stringify(data), 'EX', idleTtlSeconds)
      .sadd(indexKey(data.tenantId, data.employeeId), sha256(token))
      .exec();
    return token; // returned to the client once
  }

  /** Sliding idle timeout + hard absolute expiry */
  async touch(token: string, idleTtlSeconds: number): Promise<SessionData | null> {
    const raw = await this.redis.get(sessionKey(token));
    if (!raw) return null;
    const data = JSON.parse(raw) as SessionData;
    if (Date.now() > data.absoluteExpiresAt) {
      await this.destroy(token, data);
      return null;
    }
    await this.redis.expire(sessionKey(token), idleTtlSeconds);
    return data;
  }

  async destroy(token: string, data: SessionData): Promise<void> {
    await this.redis.multi()
      .del(sessionKey(token))
      .srem(indexKey(data.tenantId, data.employeeId), sha256(token))
      .exec();
  }

  /** Password change, deactivation, suspected compromise: kill every session of the employee */
  async destroyAllFor(tenantId: string, employeeId: string): Promise<void> {
    const hashes = await this.redis.smembers(indexKey(tenantId, employeeId));
    if (hashes.length) await this.redis.del(...hashes.map((h) => `sess:${h}`));
    await this.redis.del(indexKey(tenantId, employeeId));
  }
}
```

(Пример на API `ioredis`; с клиентом `redis` вызовы отличаются — клиент выбирается один раз.)

- Idle TTL = таймаут сети тенанта (из БД, кэш), зажатый в `[SESSION_IDLE_TIMEOUT_MIN, MAX]`.
- В сессии нет пароля, PIN, ПДн — только идентификаторы.
- Сессии stateless-инстансов api общие через Redis (горизонтальное масштабирование, ADR-0002).

## Вход по логину и паролю

```typescript
// apps/api/src/auth/sessions.controller.ts (fragment)
@Public()
@Throttle({ default: { limit: 10, ttl: 60_000 } })
@Post('sessions')                                   // POST /api/v1/sessions
async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response): Promise<SessionResponseDto> {
  const { token, session } = await this.auth.loginWithPassword(dto); // tenantCode + login + password
  res.cookie('sid', token, { httpOnly: true, secure: true, sameSite: 'strict', path: '/api' }); // transport per ADR
  return toSessionResponse(session); // employee name, permissions for UI — no token in body when using cookie
}
```

```typescript
// apps/api/src/auth/auth.service.ts (fragment)
async loginWithPassword(dto: LoginDto) {
  const employee = await this.employees.findActiveByLogin(dto.tenantCode, dto.login);
  // Same error and comparable timing for "no such login" and "wrong password"
  const ok = employee !== undefined && (await this.hasher.verify(dto.password, employee.passwordHash));
  if (!employee || !ok) {
    await this.attempts.registerFailure(dto.tenantCode, dto.login); // lockout after N failures
    await this.auditFailedLogin(dto);                                // no password in audit
    throw new UnauthorizedException('Invalid credentials');
  }
  await this.attempts.reset(dto.tenantCode, dto.login);
  // ... build SessionData, create session, append 'auth.login' audit record
}
```

- Неизвестный логин и неверный пароль неразличимы для клиента.
- Все входы, неудачи, блокировки, выходы, переключения по PIN — в аудит (без секретов).
- Политика паролей (длина, смена, история) — по требованиям ИБ; проверяется в DTO и сервисе.

## PIN на привязанном терминале

1. Терминал однократно привязывается к точке сотрудником с правом `pos:terminal-bind`
   (протокол — ADR/ИБ). Терминал получает credential; в БД — только его хеш.
2. Кассир переключается: `POST /api/v1/terminal-sessions` c `{ employeeCode, pin }` +
   credential терминала. Проверяется: терминал не отозван, сотрудник активен и имеет
   доступ к точке терминала, PIN верен.
3. Сессия PIN — с `terminalId`, охват = **только** точка терминала, idle-таймаут сети тенанта.
4. Счётчик неудач — по `(tenantId, employeeId, terminalId)` в Redis; после
   `PIN_MAX_ATTEMPTS` — блокировка PIN на `PIN_LOCKOUT_SECONDS` (вход только паролем) + аудит.

## Guards

```typescript
// apps/api/src/auth/decorators/public.decorator.ts
export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

// apps/api/src/auth/decorators/require-permission.decorator.ts
export interface StoreScopeOptions { storeParam?: string; storeQuery?: string }
export interface PermissionRequirement { module: string; action: string; scope?: StoreScopeOptions }
export const PERMISSION = 'permission';
export const RequirePermission = (module: string, action: string, scope?: StoreScopeOptions) =>
  SetMetadata(PERMISSION, { module, action, scope } satisfies PermissionRequirement);
```

```typescript
// apps/api/src/auth/guards/session-auth.guard.ts
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly auth: AuthService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const token = extractSessionToken(req);            // cookie or header — per ADR
    const session = token ? await this.auth.resumeSession(token) : null; // touch + idle TTL
    if (!session) throw new UnauthorizedException();

    const store = requestContextStorage.getStore();     // created by CorrelationIdMiddleware
    if (!store) throw new Error('Request context is not initialized');
    Object.assign(store, {
      tenantId: session.tenantId,
      employeeId: session.employeeId,
      storeScope: session.storeScope,
      terminalId: session.terminalId,
      actingOperatorId: session.actingOperatorId,
      permissions: await this.auth.permissionsFor(session), // cached by roleId + roleVersion
    });
    return true;
  }
}
```

```typescript
// apps/api/src/auth/guards/permissions.guard.ts
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;

    const req = this.reflector.getAllAndOverride<PermissionRequirement>(PERMISSION, [ctx.getHandler(), ctx.getClass()]);
    // Fail closed: an authenticated route without @RequirePermission is a programming error
    if (!req) throw new ForbiddenException();

    const rc = getRequestContext();
    if (!rc?.permissions?.has(`${req.module}:${req.action}`)) throw new ForbiddenException();

    const http = ctx.switchToHttp().getRequest<Request>();
    const storeId = req.scope?.storeParam
      ? http.params[req.scope.storeParam]
      : req.scope?.storeQuery ? String(http.query[req.scope.storeQuery] ?? '') : undefined;
    if (req.scope && !storeId) throw new ForbiddenException();
    if (storeId && rc.storeScope !== 'all' && !rc.storeScope.includes(storeId)) throw new ForbiddenException();
    return true;
  }
}
```

Guard проверяет охват по идентификатору точки из запроса; принадлежность точки **тенанту**
гарантирует tenant-scoped запрос (`WHERE tenant_id = $1 AND store_id = $2`) и RLS. Чужая точка
= «не найдено» (404), не 403 — не раскрываем существование.

## Синхронизация офлайн-точек — лицензионный ключ

- Эндпоинты `sync` не используют сессии сотрудников: `@Public()` для `SessionAuthGuard` +
  собственный `LicenseKeyGuard`.
- Ключ уникален для точки, в БД — хеш; проверяется на каждом запросе; отзыв вступает в силу
  при следующей синхронизации (глоссарий). Guard устанавливает `tenantId`/`storeId` точки в контекст.
- Только HTTPS; каждый пакет — idempotency key операции + correlation ID
  (`nestjs-messaging-basics.md`).

## Оператор платформы (apps/admin)

Отдельное пространство сессий (`op-sess:`), отдельный guard и набор прав оператора.
Вход «от имени» тенанта — ограниченная по времени tenant-сессия с `actingOperatorId`, который
попадает в каждую запись аудита. Механика — ADR до реализации.

## Запрещено

- JWT/OAuth/SSO-провайдеры как замена серверным сессиям без ADR.
- Хранение пароля/PIN/токена в открытом виде, в логах, в аудите, в кэше.
- `tenantId`, `storeId`-охват или права, пришедшие от клиента, как источник истины.
- Маршрут без `@RequirePermission` и без `@Public()`.
- Собственные реализации хеширования/шифрования.
