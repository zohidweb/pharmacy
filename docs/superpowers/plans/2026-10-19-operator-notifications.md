# Уведомления оператора и объявления сетям на API — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** колокольчик, счётчик меню и «Уведомления» админки работают на API; оператор публикует и снимает объявления, а
сотрудники сетей видят их баннером в облачном вебе.

**Architecture:**
- Миграция: `platform_notifications`, `platform_notification_reads`, `platform_notification_refresh` (класс `platform`),
  `announcements` (класс `shared`), `operators.muted_notification_topics`.
- Состояния очереди (просроченные счета, ключи, синхронизация, заявки) — один провайдер `OperatorQueue` модуля
  `platform/stats`: его читают и дашборд, и уведомления.
- Новый модуль `app/platform/notifications`:
  - обновление уведомлений при чтении — не чаще раза в 5 минут, под advisory-блокировкой;
  - список, «прочитать все», настройки колокольчика, счётчики меню (контроллер переезжает из `platform/billing`);
  - объявления.
- Тенантский модуль `notifications` отдаёт идущие объявления сети (`GET /announcements`); веб показывает баннер в оболочке.

**Tech Stack:** NestJS 11, Kysely + pg (`platformTransaction`, `tenantTransaction`), node-pg-migrate (SQL); Next.js static
export, TanStack Query, use-intl, `@pharmacy/ui`; Jest.

**Spec:** `docs/superpowers/specs/2026-10-19-operator-notifications-design.md` — решения N1–N16, разделы 3 (схема), 4
(обновление), 5 (API), 6 (контракт), 7 (админка), 8 (веб), 9 (журнал), 11 (документы), 12 (проверка).

## Global Constraints

**Тесты.**
- Новых автотестов нет (правило «тесты до MVP»), долг — в описании PR (спецификация, 12).
- Существующие наборы `api`, `admin`, `web`, `shared-dto` остаются зелёными.
- Проверка — сквозным скриптом на временной базе и скриншотами (Задача 8).

**База.**
- Одна миграция; номер — `Date.now()` при создании, больше всех номеров `origin/main`, `origin/*` и основной папки.
- Миграцию не применять к общим базам `pharmacy` и `pharmacy_test`; `api:integration` не запускать.
- Временная база — `pharmacy_notif_check` (лаунчер `ops_env2.mjs`, `OPS_DB`). Создать и удалить — `drop_scratch.mjs` и
  `docker exec … psql -U postgres` (как в плане дашборда).

**Окружение и git.**
- Только worktree `C:\Projects\AI Projects\pharmacy-minors`, ветка `feature/operator-notifications` без upstream.
- Коммиты — `git commit --no-gpg-sign` с `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Prettier — только для файлов, отформатированных на `origin/main`, и для новых.

**Правила спецификации.**
- Обновление не чаще раза в 5 минут; события видны 30 дней; `limit` ≤ 50.
- Тема ↔ виды (N5): `billing` — `invoice_overdue`, `payment_recorded`; `keys` — `key_expiring`, `key_revoked`;
  `services` — `service_requested`; `sync` — `sync_stale`, `update_available`.
- Права (N12): уведомления, настройки, список объявлений — `platform:view`; публикация и снятие — `platform:manage`;
  маршрут сети — `@Authenticated()`.
- Объявление (N12): заголовок 3–120 символов, текст 10–1000, начало раньше окончания, окончание в будущем; иначе 400
  `validation_failed` с полем; снятие не идущего и не запланированного — 409 `not_active`.
- Журнал: `announcement.published`, `announcement.cancelled` (тип `settings` уже настроен в
  `operator-audit.repository.ts`), `details: { scope }`.
- Платформенные таблицы без `DELETE`; модули оператора и маршрут объявлений — только в облаке.

## Review Focus

1. **Состояние, которое ушло и вернулось.** Счёт оплатили, потом платёж отменили: первое уведомление снято, появилось
   новое, непрочитанное. Проверка — Задачи 4, 8.
2. **Два оператора и «прочитано».** Отметка одного не меняет счётчик другого; «прочитать все» затрагивает только
   видимые уведомления. Проверка — Задачи 4, 8.
3. **Настройки колокольчика.** Выключенная тема пропадает из колокольчика и счётчика, но остаётся на странице и в
   счётчиках тем. Проверка — Задачи 4, 6, 8.
4. **Круг объявления.** Сеть только с офлайн-точками не видит объявление `cloud`; сеть без точек не видит ни `cloud`,
   ни `offline`; снятое и закончившееся не видит никто. Проверка — Задачи 5, 8.
5. **Касса и офлайн-развёртывание.** Баннер не перекрывает кассу на 1280×800; на офлайн-точке запрос объявлений не
   уходит. Проверка — Задачи 7, 8.

---

### Task 1: Контракт

**Files:**
- Modify: `libs/shared/dto/src/lib/platform-system.ts`, `libs/shared/dto/src/lib/tenant-home.ts`.
- Modify: `apps/admin/src/shared/api/routes.ts` (запрос `notifications.list`), `apps/web/src/shared/api/routes.ts` (новый
  маршрут), моки веба — минимум для компиляции.

**Interfaces:**
- Produces:
  - `NotificationListQuery { topic?: NotificationTopic; bell?: boolean; limit?: number; offset?: number }` —
    `platform-system.ts`, запрос маршрута `notifications.list` админки.
  - `NotificationTopic`, `PlatformNotification`, `NotificationListResponse`, `Announcement`, `CreateAnnouncementRequest`,
    `NotificationPreferences` — без изменения формы, с комментариями по правилам N3–N13 и кодами ошибок N12.
  - `TenantAnnouncement { id: string; title: string; text: string; startsAt: string; endsAt: string }` — `tenant-home.ts`.
  - Маршрут веба `'announcements.list': route<TenantAnnouncement[]>('GET', () => '/announcements')`; мок — пустой
    список.

- [ ] **Step 1: Контракт** по Interfaces.
- [ ] **Step 2: Проверка.** `npx nx run-many -t lint test typecheck -p shared-dto admin web`.
  Expected: зелёные.
- [ ] **Step 3: Коммит** `feat(dto): operator notifications query and tenant announcements`.

### Task 2: Миграция

**Files:**
- Create: `apps/api/migrations/<ms>_operator-notifications.sql`.
- Modify: `apps/api/src/core/database/table-classes.ts`, `db.generated.ts`; модель данных `06-sync-audit-billing.md`
  (три таблицы вместо строки-заглушки `platform_notifications`), `01-platform-org.md` (`announcements`, колонка
  `operators`), `README.md` (классы).

**Interfaces:**
- Produces (спецификация, раздел 3, дословно):
  - `platform_notifications` (`id uuid pk`, `kind` CHECK по семи видам N5, `dedupe_key text` 1–200 символов,
    `tenant_id null` → `tenants`, `store_id null` и `foreign key (tenant_id, store_id)` → `stores`, `entity_type`,
    `entity_id uuid`, `params jsonb` (объект), `created_at`, `resolved_at null`);
    `create unique index platform_notifications_open_key_uq … (dedupe_key) where resolved_at is null`; индекс
    `(created_at)`;
  - `platform_notification_reads` (ключ `(notification_id, operator_id)` → обе таблицы, `read_at default now()`);
  - `platform_notification_refresh` (`id smallint primary key check (id = 1)`, `refreshed_at`, `events_after`);
  - `announcements` (`id uuid pk`, `title` 3–120, `text` 10–1000, `starts_at`, `ends_at`, `check (ends_at >
    starts_at)`, `scope` CHECK `all`/`cloud`/`offline`, `created_by` → `operators`, `created_at`, `cancelled_at null`,
    `cancelled_by null` → `operators`, `check ((cancelled_at is null) = (cancelled_by is null))`); индекс `(ends_at)`;
  - `alter table pharmacy.operators add column muted_notification_topics text[] not null default '{}'` с CHECK
    `muted_notification_topics <@ array['billing','keys','services','sync']`;
  - RLS `enable` + `force`; уведомления: `platform_all for all to pharmacy_platform using (true) with check (true)`;
    гранты `pharmacy_platform` — `select, insert, update`; `pharmacy_app` — ничего. `announcements`:
    `platform_all` как выше + `tenant_read for select to pharmacy_app using (true)`; гранты `pharmacy_platform` —
    `select, insert, update`, `pharmacy_app` — `select`;
  - `table-classes.ts`: три таблицы — `'platform'`, `announcements` — `'shared'`.

- [ ] **Step 1: Номер миграции** — сверка номеров (Global Constraints); найденный максимум — в ledger.
- [ ] **Step 2: Миграция** по Interfaces; шапка — ссылка на спецификацию (N1, N9, N11).
- [ ] **Step 3: Временная база** — создать `pharmacy_notif_check`, применить все миграции, `kysely-codegen` и `--verify`.
  Expected: применены все миграции, `--verify` чистый.
- [ ] **Step 4: Модель данных** по Files.
- [ ] **Step 5: Проверка.** `npx tsc -b apps/api/tsconfig.json`; `check-docs`; гранты по `information_schema` на
  временной базе.
  Expected: гранты как в Interfaces.
- [ ] **Step 6: Коммит** `feat(api): operator notifications and announcements tables`.

### Task 3: Общий источник очереди (`OperatorQueue`)

**Files:**
- Create: `apps/api/src/app/platform/stats/operator-queue.ts`.
- Modify: `stats.service.ts` (дашборд берёт состояния из `OperatorQueue`), `platform-stats.module.ts` (провайдер,
  `exports`), `apps/api/src/app/platform/billing/billing-overview.ts` (`pendingCount`).

**Interfaces:**
- Produces:
  - `OperatorQueue` (платформенная транзакция `trx: Transaction<DB>`; те же запросы, что дашборд сейчас):
    - `overdueInvoices(trx, today)` — из `BillingOverview`;
    - `expiringKeys(trx, today): Promise<ExpiringKey[]>`, `staleStores(trx, today): Promise<StaleStore[]>` — из
      `StatsRepository`, типы реэкспортируются;
    - `pendingRequests(trx): Promise<ServiceRequestItem[]>`.
  - `BillingOverview.pendingCount(trx): Promise<number>` — `ServiceOrdersRepository.countPending`.
  - `PlatformStatsModule` экспортирует `OperatorQueue` (`platform/stats` → `platform/notifications`).

- [ ] **Step 1: `OperatorQueue`** по Interfaces; `StatsService.dashboard()` берёт четыре списка из него, поведение
  дашборда не меняется.
- [ ] **Step 2: Проверка.** `npx nx run-many -t lint test typecheck -p api`.
  Expected: зелёные.
- [ ] **Step 3: Коммит** `refactor(api): one source for the operator queue states`.

### Task 4: Уведомления оператора (`app/platform/notifications`)

**Files:**
- Create в `apps/api/src/app/platform/notifications/`:
  - `platform-notifications.module.ts`;
  - `notification-topics.ts` — темы ↔ виды;
  - `notifications.repository.ts`, `notifications-refresh.ts`, `notifications.service.ts`;
  - `notifications.controller.ts`, `attention.controller.ts` (перенос из `platform/billing`);
  - `dto/notifications.dto.ts`.
- Delete: `apps/api/src/app/platform/billing/attention.controller.ts` (и из `PlatformBillingModule`).
- Modify: `apps/api/src/app/app.module.ts` (регистрация в облаке), `CLAUDE.md` (граф модулей).

**Interfaces:**
- Consumes: `OperatorQueue`, `BillingOverview.pendingCount` (Задача 3), таблицы Задачи 2.
- Produces:
  - `TOPIC_KINDS: Record<NotificationTopic, readonly EventKind[]>` и `topicOf(kind): NotificationTopic` (N5).
  - `NotificationsRefresh.run(trx): Promise<void>` — спецификация, раздел 4:
    - ключи дедупликации — `invoice:<id>`, `key:<id>`, `sync:<storeId>`, `request:<id>`, `payment:<id>`,
      `revoked:<keyId>`;
    - параметры и переходы — как пункты очереди дашборда (N10); у платежа — `tenantName` и `amountMinor`;
    - события — платежи (`tenant_payments.created_at > events_after`, `cancelled_at is null`) и отзывы ключей
      (`license_keys.revoked_at > events_after`), отметка «прочитано» автору (`recorded_by`, `revoked_by`, если не
      `null`);
    - первая отметка без строки — события за последние 30 дней.
  - `NotificationsService`:
    - `list(query: NotificationListQuery): Promise<NotificationListResponse>`;
    - `readAll(): Promise<void>`;
    - `unread(): Promise<number>` — непрочитанные во включённых темах;
    - `preferences()` / `updatePreferences(next: NotificationPreferences)`.

    Каждый метод чтения сначала вызывает `refreshIfStale()` (отдельная platform-транзакция: `pg_try_advisory_xact_lock`,
    `refreshed_at` старше 5 минут или строки нет).
  - Видимость (N7): `resolved_at is null` для состояний; для событий — `created_at > now() - interval '30 days'`.
    Порядок — `created_at desc, id desc`. `counts` — по темам видимых; `unread` — видимые без отметки оператора.
    `bell=true` — без тем из `muted_notification_topics`.
  - Маршруты:
    - `GET operator/notifications` (`NotificationListQueryDto`: `topic` из тем, `bell` boolean, `limit` 1–50 —
      по умолчанию 20, `offset` ≥ 0);
    - `POST operator/notifications/read-all` → 204;
    - `GET`/`PUT operator/me/notification-preferences` (`NotificationPreferencesDto`: четыре boolean, лишние ключи —
      400);
    - `GET operator/attention-counts` → `{ serviceRequests: pendingCount, expiringLicenses: 0, unreadNotifications: unread() }`.

    Все — `@RequireOperatorPermission('platform:view')`.
  - `PlatformNotificationsModule`: `imports: [PlatformDatabaseModule, PlatformBillingModule, PlatformStatsModule]`.

- [ ] **Step 1: Темы, репозиторий, обновление, сервис** по Interfaces; запросы — по образцу
  `apps/api/src/app/notifications/notifications.repository.ts` (`upsert` с `on conflict … where resolved_at is null`,
  `resolveMissing`, `markAllRead … on conflict do nothing`).
- [ ] **Step 2: Контроллеры и модуль**; перенос счётчиков меню; регистрация в `AppModule` под
  `ConditionalModule.registerWhen(…, env.STORE_MODE !== 'offline')`.
- [ ] **Step 3: `CLAUDE.md`** — в абзац «Дашборд и статистика админки»: «уведомления оператора — `app/platform/notifications`:
  состояния берёт у `platform/stats` (`OperatorQueue`), счётчик заявок — у `platform/billing` (`BillingOverview`)».
- [ ] **Step 4: Проверка.** `npx nx run-many -t lint test typecheck -p api`; `npx nx build api`.
  Expected: зелёные, сборка есть.
- [ ] **Step 5: Коммит** `feat(api): operator notifications — refresh on read, reads per operator, bell preferences`.

### Task 5: Объявления (оператор и сеть)

**Files:**
- Create: `apps/api/src/app/platform/notifications/announcements.repository.ts`, `announcements.service.ts`,
  `announcements.controller.ts`, `dto/announcements.dto.ts`.
- Create: `apps/api/src/app/notifications/announcements.controller.ts` (тенантский маршрут), запрос — в
  `notifications.repository.ts` модуля сети.
- Modify: `platform-notifications.module.ts`, `apps/api/src/app/notifications/notifications.module.ts`.

**Interfaces:**
- Produces:
  - `GET operator/announcements` (`platform:view`) → `Announcement[]` — не снятые и не закончившиеся, по `starts_at`;
    статус выводится: `scheduled` (`starts_at > now()`) или `published`.
  - `POST operator/announcements` (`platform:manage`, `CreateAnnouncementDto`) → 201 `Announcement`. Проверки N12:
    - длины — class-validator;
    - `startsAt < endsAt` и `endsAt > now()` — сервис, `FieldProblemException(400, 'validation_failed',
      [{ field: 'endsAt', code: 'before_start' | 'past' }])`.

    Журнал — `PlatformAuditService.append(trx, { action: 'announcement.published', entityType: 'announcement',
    entityId, details: { scope } })`.
  - `POST operator/announcements/:id/cancellation` (`platform:manage`, `ParseUUIDPipe`) → 200 `Announcement` со статусом
    `cancelled`. Неизвестное — 404; уже снятое или закончившееся — 409 `not_active`; строка блокируется `for no key
    update`. Журнал — `announcement.cancelled`.
  - `GET announcements` (тенантский, `@Authenticated()`) → `TenantAnnouncement[]`: идущие (`starts_at <= now() < ends_at`,
    не снятые), круг N13 по точкам своей сети (`stores` со статусом `active`/`closing`; `cloud` — есть с
    `mode = 'online'`, `offline` — есть с `mode <> 'online'`); по `ends_at`.

- [ ] **Step 1: Платформенная часть** по Interfaces.
- [ ] **Step 2: Тенантский маршрут** — в модуле `notifications` (только облако, как модуль).
- [ ] **Step 3: Проверка.** `npx nx run-many -t lint test typecheck -p api`; `npx nx build api`.
  Expected: зелёные.
- [ ] **Step 4: Коммит** `feat(api): announcements to networks — operator publishes and cancels, staff reads`.

### Task 6: Админка

**Files:**
- Modify:
  - `apps/admin/src/shared/api/client.ts`;
  - `apps/admin/src/widgets/app-shell/ui/NotificationsBell.tsx`;
  - `apps/admin/src/pages/notifications/ui/NotificationsPage.tsx`;
  - моки `handlers-system.ts`, `db-system.ts`;
  - тексты `ru.json`, `tg.json` (только если появятся новые ключи, например для 409 `not_active`).

**Interfaces:**
- Consumes: маршруты Задач 4–5.

- [ ] **Step 1: `REAL_API_ROUTES`** += `notifications.list`, `notifications.readAll`, `announcements.list`,
  `announcements.create`, `announcements.cancel`, `me.notificationPreferences`, `me.updateNotificationPreferences`.
- [ ] **Step 2: Экраны.**
  - Колокольчик — `query: { limit: 20, bell: true }`.
  - После сохранения настроек и «Отметить прочитанными» — `invalidateQueries` счётчиков меню и колокольчика.
  - Ошибки формы объявления — по полям ответа (`endsAt`: `before_start`, `past`), 409 `not_active` — тостом с текстом.
- [ ] **Step 3: Моки — как API.** 400 вместо 422, `bell`, «прочитано» автору платежа, переходы N10, отказ `not_active`.
- [ ] **Step 4: Проверка.** `npx nx run-many -t lint test fsd build -p admin`.
  Expected: зелёные.
- [ ] **Step 5: Коммит** `feat(admin): notifications, bell preferences and announcements on the API`.

### Task 7: Веб — баннер объявлений

**Files:**
- Create: `apps/web/src/widgets/app-shell/ui/AnnouncementsBanner.tsx`.
- Modify:
  - `AppShell.tsx` (рядом с `ImpersonationBanner`);
  - `apps/web/src/shared/api/client.ts` (`REAL_API_ROUTES` += `announcements.list`);
  - моки веба — одно объявление в демо-данных;
  - `apps/web/src/shared/i18n/messages/ru.json`, `tg.json`.

**Interfaces:**
- Consumes: `TenantAnnouncement`, маршрут `announcements.list` (Задача 1).
- Produces:
  - `AnnouncementsBanner()`:
    - запрос — только если `deployment.get` (`queryKey ['deployment']`) не `offline-store`;
    - `refetchInterval: 600_000`, `refetchOnWindowFocus`;
    - для каждого незакрытого объявления — строка `Alert tone="info"`: заголовок, «Подробнее» раскрывает текст,
      «Закрыть» пишет id в `localStorage` (`pharmacy-web-dismissed-announcements`, чтение и запись в try/catch);
    - ближайшее окончание первым.
  - Тексты `shell.announcement.more`, `shell.announcement.less`, `shell.announcement.dismiss` (RU/TJ).

- [ ] **Step 1: Баннер** по Interfaces; на кассе — та же строка, без перекрытия раскладки (`PosLayout` не меняется).
- [ ] **Step 2: Проверка.** `npx nx run-many -t lint test fsd build -p web`.
  Expected: зелёные (паритет ключей).
- [ ] **Step 3: Коммит** `feat(web): announcements banner of the platform`.

### Task 8: Сквозная проверка, документы, PR

**Files:**
- Create (scratchpad, не в PR): `notif_live.mjs` — на основе `billing_pr2_lib.mjs`, `billing_seed.mjs`; скрипт экранов в
  workspace плана (как `screens.mjs` дашборда).
- Create: `.superpowers/pr-operator-notifications.md`.
- Modify: `CLAUDE.md` (списки `admin:dev-api` и `web:dev-api`).

- [ ] **Step 1: Стенд** — временная база Задачи 2, собранный API на `:4318`.
- [ ] **Step 2: Сценарий** — спецификация, 12, полностью, плюс Review Focus 1–5:
  - два оператора;
  - сети: с облачной и офлайн-аптекой, только с офлайн-точкой, без точек;
  - просроченный счёт, ключ за 3 дня, офлайн-точка без синхронизации 8 дней, заявка, платёж, отзыв ключа.

  Проверить:
  - появление, обновление параметров и снятие каждого состояния; повторное появление после отмены платежа;
  - события у автора прочитаны, у второго оператора — нет;
  - `bell` и счётчик меню по настройкам; пределы 5 минут (сдвиг `refreshed_at` назад);
  - объявления: 400 по полям, 409, снятие, журнал; круг для трёх сетей; закончившееся не видно.
- [ ] **Step 3: Экраны.**
  - Админка в режиме API (сборка `NEXT_PUBLIC_API_MOCKS=partial` с прокси на `:4318`) — «Уведомления» и колокольчик.
  - Веб в режиме API — баннер на главной и на кассе 1280×800.
  - Всё на RU и TJ. После снимков пересобрать админку и веб обычным образом (`--skip-nx-cache`), чтобы в кэше Nx была
    обычная сборка.
- [ ] **Step 4: Полный прогон** `npx nx run-many -t lint test typecheck fsd -p api admin web shared-dto`, `check-docs`,
  `nx sync:check`.
- [ ] **Step 5: Ревью ветки** — `nestjs-reviewer` и `postgresql-database-reviewer` (только чтение). Существенное
  исправить: сначала воспроизвести, повторить сценарий. Мелкое — в ledger и PR.
- [ ] **Step 6: PR-текст.** Что сделано, ссылка на спецификацию, как проверено, долг по тестам, просьба прогнать
  `api:migrate`, `api:db-types-verify`, `api:integration`, api-e2e, web-e2e. Временную базу удалить, API остановить.
- [ ] **Step 7: Слияние и пуш.** Если `main` ушёл вперёд — влить `origin/main` (коммит слияния с `Co-Authored-By`),
  повторить проверки, затем
  `git push -u origin feature/operator-notifications:feature/operator-notifications`. Пользователю — ссылка compare,
  заголовок и файл описания.
