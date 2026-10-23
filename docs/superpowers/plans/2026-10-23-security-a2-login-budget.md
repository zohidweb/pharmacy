# Бюджет попыток учётной записи, частые пароли, аудит блокировок (ревью безопасности A2, P2, решение 7.5): план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** подбор пароля сотрудника ограничен дневным потолком на учётную запись, а не на каждый из трёх её
идентификаторов; частые пароли не принимаются; каждая блокировка входа попадает в журнал, а владелец получает
уведомление.

**Architecture:**
- Второй экземпляр существующего `LoginLimiter` (тот же скрипт Lua, своя политика) — `AccountLimiter`, ключ
  `account:<tenantId>:<employeeId>`. Резервирует попытку вход по паролю, подтверждение паролем и смена своего пароля.
- Скрипт лимитера сообщает, что попытка поставила блокировку. Запись в журнал — только когда эта попытка не стала
  успешной: так одна блокировка — одна запись, а отказы 429 во время блокировки не пишутся.
- Новый сервис `SignInLocks` модуля `auth` собирает бюджет учётной записи, запись блокировок и снятие блокировок.
  Последнее нужно новому паролю от заведующего и активации.
- Правило `common` в общей `passwordProblems`: сервер и чек-листы web/admin проверяют одно и то же.
- Уведомление — новый вид `login_locked`, событие, по образцу `receipt_discrepancy` (порт модуля `audit` → обновление
  уведомлений).

**Tech Stack:** NestJS, node-redis (Lua), Kysely/`sql`, PostgreSQL (миграция CHECK), Next.js static export (FSD), use-intl.
Новых зависимостей и переменных окружения нет.

**Spec:**
- `docs/architecture/reviews/2026-10-22-security-review.md`: находки A2 и P2, решение 7.5, пункт 8.2. Рекомендация автора к
  7.5: «да, с дневным потолком и уведомлением владельцу о блокировке».
- Отчёты `2026-10-22-security-review/r1-auth.md` (A2) и `r6-data-privacy.md` (P2).
- Спецификация аутентификации `docs/superpowers/specs/2026-10-02-auth-design.md`, раздел 6; ADR-0008.

## Решения автора (утверждение плана — решение 7.5 и утверждение поправки ADR-0008)

| № | Вопрос | Решение |
|---|---|---|
| L1 | Бюджет учётной записи | Ключ `account:<tenantId>:<employeeId>`, политика `ACCOUNT_LIMITER_OPTIONS`: 10 попыток за 3600 с, блокировка 3600 с, повторная — 21 600 с (6 ч) в течение 86 400 с. Это ≈ 50 попыток в сутки на учётную запись. Сейчас — ≈ 120 на каждый из трёх идентификаторов, ≈ 350 в сутки. Значения — константы, без переменных окружения. Политика идентификатора (5 / 900 с, `LOGIN_MAX_FAILURES`, `LOGIN_LOCK_SECONDS`) не меняется |
| L2 | Что расходует бюджет | Вход по паролю (любым идентификатором), подтверждение паролем (`POST /sessions/current/confirmation`), смена своего пароля (`POST /me/password`). Не расходуют: вход по PIN (своя блокировка в БД), активация (подбирают код, не пароль; свой ключ), операторы (один идентификатор — e-mail; их ключ не меняется) |
| L3 | Порядок и ответ | Сначала, как сейчас, ключ самой попытки (идентификатор, `reconfirm:…`, `password-change:…`). Бюджет учётной записи — после `resolve_login`, до scrypt. Пароль подтверждён — сбрасываются оба ключа. Бюджет исчерпан — тот же `429 login_locked` с `Retry-After`, без дополнения до пола времени. Неизвестный идентификатор бюджета не имеет |
| L4 | Снятие блокировки | Снимают: новый пароль от заведующего или владельца (`POST /employees/:id/password`) и успешная активация (код от оператора). Сбрасываются бюджет учётной записи, вход по каждому идентификатору сотрудника (логин, телефон, e-mail), `reconfirm:…` и `password-change:…`. История блокировок остаётся, как после успешного входа. Ошибка снятия пишется в лог и не меняет ответа: пароль уже задан |
| L5 | Сигнал блокировки | Скрипт Lua возвращает `−lockMs`, когда попытка дошла до максимума и поставила блокировку. `LoginAttempt` получает необязательное `lockSeconds`. `MemoryLoginLimiter` (офлайн-точка) делает то же |
| L6 | Аудит блокировки (P2) | `auth.login-locked` в `audit_log` сети, `entityType: 'employee'`. Пишется, когда попытка, поставившая блокировку, закончилась не успехом: ошибкой входа, 422 или 429 по другому ключу. Успех снимает свою блокировку — записи нет. Отказы 429 во время блокировки не пишутся. `details`: `scope` (`identifier`, `account`, `reconfirm`, `password-change`, `activation`), `lockSeconds`; `kind` (`login`, `phone`, `email`, без значения) для `identifier` и `activation`; `ip` для входа и активации. Неизвестный идентификатор — только лог приложения, без значения. Оператор — `auth.operator-login-locked` в `platform_audit_log` (`ip`, `lockSeconds`) в одной транзакции с `auth.operator-login-failed`; неизвестный логин — лог приложения |
| L7 | Частые пароли | Новое правило `common` в `passwordProblems` (`libs/shared/domain`), последнее в чек-листе. Пароль частый, если: (1) начинается с клавиатурного шаблона; (2) его «ядро» входит в список базовых слов; (3) ядро — один повторённый символ. Ядро — пароль в NFKC и нижнем регистре, без не-букв по краям, с заменами `@4→a`, `0→o`, `1!\|→i`, `3→e`, `$5→s`, `7→t`. Список слов ~110: английские, русские, таджикские, транслит, аптечные и местные (город, страна, валюта, домен продукта). Пустая строка правило не выполняет. Действует при задании пароля: активация, своя смена, новый сотрудник, сброс заведующим, операторы. Уже заданные пароли принудительно не меняются |
| L8 | Уведомление владельцу | Новый вид `login_locked`, событие «сотрудник × день сети»: `positions` — число блокировок за день, `employeeName`. Право — `employees:update`: тот, кто может задать новый пароль и так снять блокировку. Точки нет (уведомление сети). Новая блокировка в тот же день делает прочитанное снова непрочитанным (`reopenGrown`). Выключается в настройках сети, как прочие виды |
| L9 | Документы | Поправка ADR-0008 «2026-10-23: бюджет попыток учётной записи, частые пароли, журнал блокировок». Спецификация аутентификации, раздел 6. Модель данных 06 (события входа) и 01 (`disabled_notifications`). Строка `APPROVAL.md` (решение 7.5) |
| L10 | Остаток риска | (a) Отказ в обслуживании: знающий логин держит учётную запись заблокированной ≈ 40 запросами в сутки. Смягчение: вход по PIN на кассе не затронут, владелец получает уведомление, IP — в журнале, снятие — новым паролем. (b) Пока учётная запись заблокирована, свежий идентификатор того же сотрудника сразу отвечает 429 — видна связь идентификаторов. (c) Уже заданные частые пароли действуют до смены. (d) Список — небольшой и локальный. Проверка по базам утечек — внешний сервис, по ADR-0011 запрещена |
| L11 | Вне плана | Карточка сотрудника не показывает «вход заблокирован до …»: у лимитера нет чтения состояния; есть уведомление и журнал. Блокировки операторов не уведомляют — только журнал админки. Активация и смена пароля оператора — без новой записи о блокировке |

## Global Constraints

- Тесты отложены до MVP: проверка — живая. Существующие наборы остаются зелёными. Конструкторы `SessionsService`,
  `MeService`, `ActivationsService` получают `locks: SignInLocks` сразу после `limiter`. В их spec передаётся заглушка
  `{ reserveAccount: async () => ({ allowed: true }), resetAccount, record, unlock }` (`jest.fn`) — других правок spec нет.
  Вызов `activate` в `activations.service.spec.ts` получает `''` четвёртым аргументом.
- Стенд проверки — копия dev-БД `pharmacy_a_two_check`. `pg_dump`/`pg_restore` — суперпользователем контейнера `postgres`,
  владельцы сохраняются. API — конфигурация `api-a2-check`: `apps/api/dist/main.js` через обёртку в scratchpad,
  которая меняет имя БД в URL из `.env`; env — как у `api-oc-4210`, без `STEP_UP_MAX_AGE_SECONDS`. Web —
  `web-partial-4210` на `http://127.0.0.1:4210`, admin — `admin-partial` (4300). После проверки копия удаляется,
  конфигурация и обёртка — тоже.
- Redis общий с dev: блокировки — только новых синтетических сотрудников и операторов (`a2-…`, `a2-op@example.test`).
  Ключи — по логину, поэтому существующих пользователей не трогать.
- Значения идентификаторов не попадают ни в журнал, ни в лог; пароли — нигде.
- Миграция — SQL node-pg-migrate, только Up, `set local lock_timeout = '5s'`; CHECK пересобирается, как в
  `1792732864325_receipt-discrepancy-notification.sql`.
- Prettier — только для файлов, отформатированных на HEAD (`git show HEAD:<f> | npx prettier --stdin-filepath <f> --check`).
- Порты 4200/4201 не использовать. Коммиты `--no-gpg-sign`, Conventional Commits,
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. TJ-тексты — с отметкой для ревью TJ в описании PR.

## Review Focus

1. **Учётную запись настоящего сотрудника заблокировал чужой.** Ожидается: 429 по всем идентификаторам. Заведующий
   задаёт новый пароль — сотрудник сразу входит любым идентификатором. Проверка — задача 1, b2, b3.
2. **Попытка, поставившая блокировку, — с верным паролем.** Ожидается: 201, записи `auth.login-locked` и уведомления нет,
   следующий вход — 201. Проверка — задача 2, c2.
3. **Подбор неизвестного логина.** Ожидается: ни одной новой строки в `audit_log` или `platform_audit_log` (журналы
   append-only), только строка лога без значения. Проверка — задача 2, c3, c5.
4. **Залп параллельных запросов по трём идентификаторам.** Ожидается: за окно проходит не больше 10 попыток учётной
   записи, остальные — 429. Проверка — задача 1, b4.
5. **Заведующий задаёт сотруднику частый пароль.** Ожидается: окно сотрудника показывает «слишком частый пароль» до
   отправки, а не «непредвиденную ошибку». Сотрудник, у которого такой пароль уже был, входит. Проверка — задача 3, p2, p4.

---

### Task 1: Бюджет учётной записи и снятие блокировок (сервер)

**Files:**
- Modify: `apps/api/src/app/auth/login-limiter.ts` (тип, скрипт, `RedisLoginLimiter.tryAcquire`),
  `apps/api/src/app/auth/memory-login-limiter.ts`.
- Create: `apps/api/src/app/auth/account-limiter.ts`, `apps/api/src/app/auth/sign-in-locks.ts`.
- Modify:
  - `apps/api/src/app/auth/auth.module.ts`: фабрика лимитера выносится в функцию от `LoginLimiterOptions`, новый
    провайдер `AccountLimiter`; `SignInLocks` — провайдер и экспорт;
  - `employee-auth.repository.ts`, `sessions.service.ts`, `me.service.ts`, `activations.service.ts`;
  - `apps/api/src/app/staff/employees.service.ts`.
- Modify (spec, только конструктор): `sessions.service.spec.ts`, `me.service.spec.ts`, `activations.service.spec.ts`.
- Docs:
  - `docs/architecture/adr/0008-realizaciya-autentifikacii.md` — поправка 2026-10-23 (L1–L8, L10);
  - `docs/superpowers/specs/2026-10-02-auth-design.md` — раздел 6: шаг 3, `/me/password`, подтверждение паролем;
  - `docs/architecture/APPROVAL.md` — строка решения 7.5.

**Interfaces — Produces:**
```ts
// login-limiter.ts
export type LoginAttempt =
  | { allowed: true; /** this attempt reached the maximum and placed a lock of that many seconds */ lockSeconds?: number }
  | { allowed: false; retryAfterSeconds: number };

// account-limiter.ts
export const ACCOUNT_LIMITER_OPTIONS: Readonly<LoginLimiterOptions>; // 10, 3600, 3600, 21600, 86400 (L1)
export function accountLimiterKey(tenantId: string, employeeId: string): string; // `account:${tenantId}:${employeeId}`
export abstract class AccountLimiter extends LoginLimiter {} // DI token of the account policy

// sign-in-locks.ts
export type LockScope = 'identifier' | 'account' | 'reconfirm' | 'password-change' | 'activation';
export interface PlacedLock { scope: LockScope; lockSeconds: number; kind?: LoginKind }
export function placedLock(attempt: LoginAttempt, scope: LockScope, kind?: LoginKind): PlacedLock[]; // [] or one lock
export function reconfirmLimiterKey(tenantId: string, employeeId: string): string;      // `reconfirm:…` (as today)
export function passwordChangeLimiterKey(tenantId: string, employeeId: string): string; // `password-change:…` (as today)
@Injectable() export class SignInLocks {
  reserveAccount(tenantId: string, employeeId: string): Promise<LoginAttempt>;
  resetAccount(tenantId: string, employeeId: string): Promise<void>;
  /** L4; in the tenant context; best effort: logs the error name and correlationId, never throws. */
  unlock(tenantId: string, employeeId: string): Promise<void>;
}

// employee-auth.repository.ts
identifiers(trx: TenantTransaction, tenantId: string, employeeId: string):
  Promise<{ login: string; phone: string | null; email: string | null } | null>;
```
Ключи `unlock`: `loginLimiterKey('login', login.toLowerCase())`, `('phone', phone)`, `('email', email.toLowerCase())` —
как нормализует `normalizeIdentifier`; `reconfirmLimiterKey`, `passwordChangeLimiterKey` — через `LoginLimiter.reset`;
`accountLimiterKey` — через `AccountLimiter.reset`.

- [ ] **Step 1: Сигнал блокировки (L5).** В `TRY_ACQUIRE_SCRIPT` ветка блокировки заканчивается
  `return -tonumber(lockMs)`; комментарий над скриптом описывает три вида ответа. `tryAcquire`: `reply > 0` — отказ,
  `reply < 0` — `{ allowed: true, lockSeconds: Math.round(-reply / 1000) }`, `0` — `{ allowed: true }`. Memory-лимитер
  в ветке блокировки возвращает `lockSeconds` поставленной блокировки.
- [ ] **Step 2: `AccountLimiter`, `SignInLocks`, `identifiers`, провайдеры.**
- [ ] **Step 3: Бюджет в потоках (L2, L3).**
  - `SessionsService.loginInTenant`: первым действием `reserveAccount`. Отказ — `LockedException(429, 'login_locked',
    retryAfterSeconds)`. Успех — после `limiter.reset(key)` ещё `resetAccount`.
  - `SessionsService.confirm`: после ключа `reconfirm` — `reserveAccount` (отказ — 429). Подтверждённый пароль сбрасывает
    оба.
  - `MeService.changePassword`: так же, после ключа `password-change`. Сброс обоих — там, где сейчас `limiter.reset`.
  - Ключи `reconfirm`, `password-change` — через новые функции.
- [ ] **Step 4: Снятие блокировок (L4).** `ActivationsService.activateInTenant`: после коммита, рядом с существующим
  `afterCommitBestEffort(… limiter.reset(key))` — `locks.unlock(tenantId, employeeId)`. `EmployeesService.resetPassword`:
  после `destroyAllFor` — `locks.unlock(tenantId, employeeId)`.
- [ ] **Step 5: Документы** (L9): поправка ADR-0008, раздел 6 спецификации, строка `APPROVAL.md`.
- [ ] **Step 6: Наборы.** `npx nx test api --testPathPattern=auth` → зелёный.
  `npx nx run api:integration --testPathPattern=login-limiter` (нужен `npm run dev:deps`) → зелёный: существующие
  проверки смотрят на `.allowed`.
- [ ] **Step 7: Живая проверка.** Стенд — Global Constraints, `npx nx build api` перед запуском. Владелец синтетической
  сети создаёт сотрудников `a2-b`, `a2-c`, `a2-d`, `a2-p` с логином, телефоном и e-mail. У `a2-p` пароль `Apteka2024`
  (нужен в задаче 3, p4).
  - b1 — `a2-b`: 5 неверных входов по логину → 401 ×5; шестой, с верным паролем → 429 (как сейчас).
  - b2 — `a2-b`: 5 неверных по телефону → 401 ×5. Десятая попытка учётной записи ставит блокировку. Вход по e-mail с
    верным паролем → 429 `login_locked`, `Retry-After` ≈ 3600.
  - b3 — владелец задаёт `a2-b` новый пароль (`POST /api/v1/employees/<id>/password`, свежий вход) → 204. Вход по
    логину с новым паролем → 201 сразу.
  - b4 — `a2-c`: 15 параллельных неверных запросов, по 5 на каждый идентификатор → ровно 10 × 401 и 5 × 429.
  - b5 — `a2-d` в сессии:
    - 5 неверных подтверждений паролем → 422 ×5;
    - 5 неверных смен пароля → 422 ×5 (десятая попытка учётной записи);
    - вход по логину с верным паролем → 429;
    - сессия при этом работает (`GET /sessions/current` → 200).
- [ ] **Step 8: Commit** `fix(api): an account has its own budget of password attempts; a new password lifts the locks (security review A2)`.

### Task 2: Журнал блокировок (P2)

**Files:**
- Modify: `apps/api/src/app/auth/sign-in-locks.ts` (`record`), `sessions.service.ts`, `me.service.ts`,
  `activations.service.ts`, `activations.controller.ts` (`@Req() req`, `req.ip ?? ''`, как `sessions.controller.ts:56`).
- Modify: `apps/api/src/app/platform/auth/operator-sessions.service.ts`.
- Modify: `libs/shared/domain/src/lib/audit-groups.ts` — `auth.login-locked` в группе `sign_in`.
- Modify: i18n — web `ru/core.json`, `tg/core.json` (`auditEvents.auth_login_locked`), admin `ru.json`, `tg.json`
  (`auditLog.actions["auth_operator-login-locked"]`).
- Docs: `docs/architecture/data-model/06-sync-audit-billing.md` — события входа: `auth.login-locked`; оператора —
  `auth.operator-login-locked`.

**Interfaces:**
- Consumes: `placedLock`, `PlacedLock`, `LoginAttempt.lockSeconds` (задача 1).
- Produces: `SignInLocks.record(employeeId: string, locks: readonly PlacedLock[], ip?: string): Promise<void>`.
  Пустой список — ничего. Иначе одна `tenantTransaction` (в контексте сети): по `auth.login-locked` на блокировку,
  `details` по L6. Ошибка пишется в лог: `Could not write the auth.login-locked audit (<name>) [correlationId=…]`;
  наружу не выходит — ответ вызывающего не меняется.
- `ActivationsService.activate(rawLogin, rawCode, newPassword, ip: string)`.

- [ ] **Step 1: `record`.**
- [ ] **Step 2: Вход.**
  - `attemptLogin` передаёт в `loginInTenant` `placedLock(attempt, 'identifier', identifier.kind)`.
  - Неизвестный идентификатор при поставленной блокировке: `logger.warn('Sign-in locked: unknown <kind> [correlationId=…]')`.
  - В `loginInTenant` к списку добавляется `placedLock(account, 'account')`. Список записывается:
    - при отказе бюджета — до 429;
    - в `fail()` — после записи `auth.login-failed`.
  - Успех — ничего не пишет.
- [ ] **Step 3: Подтверждение и смена пароля.** Ключи `reconfirm` / `password-change` и `account`. Список пишется:
  - при 429 бюджета;
  - при неверном пароле: у `confirm` — после `auth.reconfirm-failed`; у `changePassword` — перед 422;
  - у `changePassword` ещё при 401 заблокированного сотрудника.
- [ ] **Step 4: Активация.** `placedLock(attempt, 'activation', identifier.kind)`.
  - `invalid_code` в сети: перехват вокруг транзакции в `activateInTenant` → `record(employeeId, locks, ip)` → проброс.
  - Неизвестный логин или неактивная сеть при поставленной блокировке: `logger.warn('Activation locked: unknown <kind> [correlationId=…]')`.
- [ ] **Step 5: Оператор.** `fail(operatorId, reason, ip, lockSeconds?: number)`. Известный оператор: в той же транзакции
  после `auth.operator-login-failed` — `auth.operator-login-locked` с `{ ip, lockSeconds }`. Неизвестный:
  `logger.warn('Operator sign-in locked: unknown login [correlationId=…]')`.
- [ ] **Step 6: Тексты журналов.**
  - Web: RU «Вход заблокирован после неверных паролей», TJ «Вуруд пас аз паролҳои нодуруст баста шуд».
  - Admin: те же тексты.
  - Модель данных 06.
- [ ] **Step 7: Наборы.** `npx nx run-many -t lint test -p api shared-domain`, `npx nx run api:typecheck` → зелёные.
- [ ] **Step 8: Живая проверка** (стенд задачи 1, API пересобран):
  - c1 — после b1–b2 в `audit_log` у `a2-b`:
    - три `auth.login-locked`: `identifier/login`, `identifier/phone`, `account`, у всех `ip`;
    - на отказы 429 записей нет.

    Журнал действий (web 4210, владелец): «Вход заблокирован после неверных паролей», в группе «Входы».
  - c2 — новый `a2-e`:
    - 4 неверных входа по логину, пятый с верным паролем → 201;
    - `auth.login-locked` нет;
    - следующий вход → 201.
  - c3 — `a2-nobody` (неизвестный логин): 5 входов → 401 ×5, новых строк `audit_log` нет. В логе API —
    `Sign-in locked: unknown login`, значения нет.
  - c4 — после b5 у `a2-d`: `reconfirm`, `password-change`, `account`. Активация: код владельцу копии
    (`create-activation-code.mjs` с URL копии), 5 неверных кодов → `activation` с `kind` и `ip`.
  - c5 — оператор `a2-op@example.test` (`create-operator.mjs` на копии, первый вход в админке): 5 неверных входов →
    `auth.operator-login-locked` с `ip` в `platform_audit_log`. Журнал админки показывает текст. Неизвестный e-mail ×5 →
    только лог.
- [ ] **Step 9: Commit** `fix(api): every sign-in lock is written to the journal once (security review P2)`.

### Task 3: Частые пароли (`common`)

**Files:**
- Create: `libs/shared/domain/src/lib/common-passwords.ts`.
- Modify: `libs/shared/domain/src/lib/password-policy.ts`:
  - `PasswordRule` = `'length' | 'upper' | 'digit' | 'common'`;
  - `common: (value) => value.length > 0 && !isCommonPassword(value)`;
  - шапка: правило и L7.
- Modify: i18n — рядом с `upper` в каждом объекте правил:
  - web `ru|tg/core.json` (чек-лист активации), `ru|tg/home.json` (профиль), `ru|tg/owner.json` (`passwordRules`,
    `passwordHint`);
  - admin `ru|tg.json` (оба объекта `rules`).

**Interfaces — Produces:** `isCommonPassword(value: string): boolean` (не экспортируется из библиотеки: только правило).

```ts
// Keyboard runs whose digits are part of the pattern, at the start of the lowered password.
const COMMON_PREFIXES = ['1q2w3e', 'q1w2e3', '1qaz2wsx', 'zaq12wsx', 'zaq1xsw2', '1qazxsw2', 'qazwsx', 'a1b2c3'];

// The bulk of guessed passwords: the core of a password (below) equal to one of these is refused.
const COMMON_WORDS = new Set([
  'password', 'passwort', 'passwd', 'pass', 'qwerty', 'qwertyuiop', 'qwertz', 'azerty', 'asdf', 'asdfgh',
  'asdfghjkl', 'zxcv', 'zxcvbn', 'zxcvbnm', 'qazwsx', 'qwe', 'qweasd', 'qweasdzxc', 'abc', 'abcd', 'abcde', 'abcdef',
  'abcdefg', 'abcdefgh', 'admin', 'administrator', 'root', 'user', 'login', 'welcome', 'letmein', 'iloveyou', 'love',
  'monkey', 'dragon', 'master', 'sunshine', 'princess', 'football', 'baseball', 'superman', 'batman', 'shadow',
  'secret', 'changeme', 'default', 'hello', 'test', 'guest', 'manager', 'owner', 'director', 'direktor', 'kassa',
  'kassir', 'privet', 'parol', 'lyubov', 'pharmacy', 'pharma', 'apteka', 'aptekar', 'dorukhona', 'doruxona',
  'dorihona', 'dorikhona', 'dushanbe', 'khujand', 'hujand', 'tajikistan', 'tojikiston', 'tajik', 'somoni', 'nurmed',
  'пароль', 'йцукен', 'йцукенг', 'фыва', 'фывапролдж', 'ячсмит', 'админ', 'администратор', 'аптека', 'аптекарь',
  'дорухона', 'душанбе', 'худжанд', 'хуҷанд', 'таджикистан', 'тоҷикистон', 'сомони', 'касса', 'кассир', 'привет',
  'любовь', 'директор', 'менеджер', 'владелец', 'нурмед',
]);

export function isCommonPassword(value: string): boolean {
  const lowered = value.normalize('NFKC').toLowerCase();
  if (COMMON_PREFIXES.some((prefix) => lowered.startsWith(prefix))) return true;
  const core = lowered
    .replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '')
    .replace(/[@4]/g, 'a').replace(/0/g, 'o').replace(/[1!|]/g, 'i')
    .replace(/3/g, 'e').replace(/[$5]/g, 's').replace(/7/g, 't');
  return COMMON_WORDS.has(core) || /^(.)\1*$/u.test(core);
}
```
Слов `demo`, имён людей и `correct`/`horse` в списке нет: на них стоят существующие наборы (`Demo12345`, `Sabina2026`,
`Correct1horse`, `Fresh-Passw0rd-7`).

- [ ] **Step 1: Правило и список.**
- [ ] **Step 2: Тексты.**
  - Чек-листы `rules` (web core и home, admin оба): RU «Не из списка частых паролей», TJ «Аз рӯйхати паролҳои маъмул нест».
  - `passwordRules.common`: RU «слишком частый пароль», TJ «пароли аз ҳад маъмул».
  - `passwordHint`: RU «Не короче 8 символов, с заглавной буквой и цифрой, не из частых паролей», TJ — то же дополнение
    к нынешней фразе.
- [ ] **Step 3: Наборы.** `npx nx run-many -t lint test -p shared-domain web admin api` → зелёные.
- [ ] **Step 4: Живая проверка** (стенд, `npx nx build api`):
  - p1 — `a2-b` в сессии, `POST /api/v1/me/password`:
    - новые пароли `Apteka2024`, `P@ssw0rd1`, `Qwerty123!`, `1q2w3e4R`, `Пароль123`, `Aaaaaaa1` → 422 `password_policy`;
    - `Correct1horse` → 204.
  - p2 — web 4210, владелец → «Сотрудники» → новый пароль `Dushanbe2026`: окно показывает «слишком частый пароль», запрос
    не уходит.
  - p3 — профиль (web): чек-лист из четырёх правил, на `Correct1horse` отмечены все. Активация в админке (4300): правило
    в чек-листе.
  - p4 — `a2-p` (пароль `Apteka2024` задан в задаче 1) входит → 201.
- [ ] **Step 5: Commit** `fix: common passwords are refused when a password is set (security review A2)`.

### Task 4: Уведомление владельцу `login_locked`

**Files:**
- Create: `apps/api/migrations/<Date.now()>_login-locked-notification.sql` — номер больше `1792732864325`. Тело —
  как у `1792732864325_receipt-discrepancy-notification.sql`: оба CHECK с `'login_locked'` в конце списков, шапка —
  ссылка на A2, решение 7.5.
- Create: `apps/api/src/app/audit/login-locks.ts`. `zoneOf` из `receipt-refusals.ts` переносится в
  `apps/api/src/app/audit/network-zone.ts` и импортируется обоими.
- Modify: `audit.module.ts` (провайдер и экспорт `LoginLocks`).
- Modify: `apps/api/src/app/notifications/notification-kinds.ts`, `notifications-refresh.ts`,
  `notifications.service.ts` (`STRING_PARAMS` + `'employeeName'`).
- Modify: `apps/api/src/app/stores/settings.service.ts`, `stores/dto/settings.dto.ts`.
- Modify: `libs/shared/dto/src/lib/tenant-home.ts` — `'login_locked'` в `NotificationKind` (JSDoc по L8),
  `ReminderParams.employeeName?: string`.
- Modify (web):
  - `entities/reminder/model/use-reminder-text.ts`: значок `lock`, тон `warning`, `employee: params.employeeName ?? '—'`;
  - `pages/owner/settings/ui/SettingsPage.tsx`;
  - моки `db-owner.ts` (`login_locked: true`), `transport.ts` (`login_locked: 'employees:update'`);
  - i18n `ru|tg/core.json` (`reminder.login_locked`), `ru|tg/owner.json` (переключатель).
- Docs: `docs/architecture/data-model/01-platform-org.md` — `login_locked` в строке `disabled_notifications`.

**Interfaces:**
- Consumes: записи `auth.login-locked` (задача 2).
- Produces:
  ```ts
  export interface LoginLocksOfDay {
    employeeId: string;
    day: string;        // YYYY-MM-DD in the network's time zone (as ReceiptRefusals)
    locks: number;      // every lock of that employee on that day
    employeeName: string;
  }
  LoginLocks.lockedDays(trx: TenantTransaction, tenantId: string, after: Date): Promise<LoginLocksOfDay[]>;
  ```
  Пары «сотрудник × день» берутся из записей `auth.login-locked`, полученных после `after`. Затем считаются все записи
  этих дней: `recorded_at` от первого дня − 1 день до последнего + 2 дня, как в `ReceiptRefusals.receipts`. Имя —
  `employees.full_name`, соединение по `(tenant_id, id)`.
- Обновление уведомлений, блок после `receipt_discrepancy`:
  - `kind: 'login_locked'`, `storeId: null`, `dedupeKey: login_locked:<employeeId>:<day>`;
  - `entityType: 'employee'`, `entityId: employeeId`;
  - `params: { positions: locks, employeeName }`;
  - `reopenGrown`, затем `upsert`.

- [ ] **Step 1: Миграция, порт, обновление, настройки, DTO.**
- [ ] **Step 2: Web и тексты.**
  - Уведомление, RU:
    - заголовок «{employee}: вход заблокирован»;
    - деталь «{positions, plural, one {# блокировка} few {# блокировки} other {# блокировок}} за день после неверных
      паролей · если входил не сотрудник, задайте ему новый пароль».
  - Уведомление, TJ:
    - заголовок «{employee}: вуруд баста шуд»;
    - деталь «{positions} баст дар як рӯз пас аз паролҳои нодуруст · агар корманд набошад, ба ӯ пароли нав диҳед».
  - Переключатель: RU «Блокировки входа» / «Сотрудника не пускает после неверных паролей подряд»; TJ «Бастани вуруд» /
    «Пас аз паролҳои нодуруст корманд ворид шуда наметавонад».
- [ ] **Step 3: Наборы.** `npx nx run-many -t lint test -p api web shared-dto`, `npx nx fsd web`,
  `npx nx run api:typecheck` → зелёные.
- [ ] **Step 4: Живая проверка.** Миграция — на копии: `node-pg-migrate` через обёртку, ролью `pharmacy_owner`. API
  пересобран.
  - n1 — владелец, `GET /api/v1/notifications` → `login_locked`:
    - у `a2-b`: `positions` 3, имя;
    - у `a2-d`: 3.

    Web 4210: текст в списке уведомлений и на главной. Кассир синтетической сети `login_locked` не видит.
  - n2 — владелец прочитал. Новая блокировка `a2-b` в тот же день (5 неверных по e-mail) → после обновления (5 мин или
    правка настроек) уведомление снова непрочитано, `positions` 4.
  - n3 — переключатель «Блокировки входа» выключен, сохранено. Новый `a2-f`: 5 неверных входов по логину (блокировка
    идентификатора) → после обновления новых `login_locked` нет; у `a2-c` блокировка из b4 ещё действует, поэтому он не
    годится.
- [ ] **Step 5: Commit** `feat: the owner is notified when an employee's sign-in is locked (security review A2)`.
