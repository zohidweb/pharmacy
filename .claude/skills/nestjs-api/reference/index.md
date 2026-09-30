# NestJS API References — Pharmacy

## Quick Navigation

| Reference | Когда загружать | Содержание |
|-----------|-----------------|------------|
| [nestjs-conventions.md](nestjs-conventions.md) | **Перед любым модулем** — Iron Law | Стек, раскладка apps/api, модули, инварианты данных, REST, именование, логи |
| [nestjs-config-basics.md](nestjs-config-basics.md) | Настройка конфигурации | Fail-fast env reader, `registerAs()`, `.env.example` |
| [nestjs-config-npm-ts.md](nestjs-config-npm-ts.md) | Зависимости, tsconfig, Nx targets | Разрешённые/запрещённые пакеты, `tsconfig.app.json`, алиасы libs |
| [nestjs-config-data-access.md](nestjs-config-data-access.md) | Любой доступ к БД, миграции | `DatabaseService.tenantTransaction`, `set_config('app.tenant_id')`, RLS, чек + движения атомарно, 23505 → 409, append-only, миграции; Prisma — вариант А при ADR |
| [nestjs-templates-core.md](nestjs-templates-core.md) | Bootstrap приложения | `main.ts` (Express), `AppModule` с 11 модулями, глобальные guards/pipe/filter, correlation ID, `CoreModule` |
| [nestjs-templates-features.md](nestjs-templates-features.md) | Новый доменный модуль / ресурс | Модуль catalog: DTO в libs/shared/dto, контроллер с правами, сервис, аудит |
| [nestjs-templates-infrastructure.md](nestjs-templates-infrastructure.md) | Docker, compose, Jest | Dockerfile api, compose локальной среды и офлайн-точки (ADR-0005), `jest.config.ts` Nx |
| [nestjs-enterprise-patterns.md](nestjs-enterprise-patterns.md) | Обработка ошибок, валидация, версии API | Доменные исключения, `ProblemDetailsFilter` (RFC 7807), таблица статусов, URI-версионирование |
| [nestjs-enterprise-infrastructure.md](nestjs-enterprise-infrastructure.md) | Заголовки безопасности, Swagger, health | helmet, опциональный Swagger, Terminus live/ready |
| [nestjs-rate-limiting.md](nestjs-rate-limiting.md) | Лимиты запросов | `@nestjs/throttler`, Redis-хранилище в облаке, трекер по сотруднику, лимиты логина/PIN |
| [nestjs-rest-workflow.md](nestjs-rest-workflow.md) | Новый эндпоинт от ТЗ до MR | Нужен ли ADR, контракт, миграция, генераторы Nx, тесты, проверка; контроллер с idempotency key |
| [nestjs-rest-dto-pagination.md](nestjs-rest-dto-pagination.md) | DTO, списки, фильтры | Маппинг строк в DTO, limit/offset, whitelist сортировки, вложенные DTO чека |
| [nestjs-rest-upload-errors.md](nestjs-rest-upload-errors.md) | Файлы и ошибки | Выгрузка 1С (CommerceML/XML), загрузка CSV в черновик документа, RFC 7807 |
| [nestjs-rest-services.md](nestjs-rest-services.md) | Сервисная логика, внешние клиенты | Порт фискализации + заглушка MVP, HTTP-клиент вендора ККМ, массовые операции, архивирование, кэш с tenantId |
| [nestjs-security-auth.md](nestjs-security-auth.md) | Аутентификация и права | Логин+пароль, PIN терминала, сессии в Redis, guards «модуль × действие × охват точек», лицензионный ключ sync |
| [nestjs-security-scanning.md](nestjs-security-scanning.md) | Аудит безопасности перед MR | `npm audit`, eslint-plugin-security, grep-аудит, CORS |
| [nestjs-security-validation-logging.md](nestjs-security-validation-logging.md) | Валидация входа, логи с ПДн | Правила DTO, маскирование ПДн/секретов, безопасный SQL, OWASP |
| [nestjs-decision-trees.md](nestjs-decision-trees.md) | Архитектурный выбор до реализации | Новая технология/ADR, размещение кода, межмодульное взаимодействие, транзакции, auth, тесты, кэш, ошибки |
| [nestjs-review-checklist.md](nestjs-review-checklist.md) | Ревью (агент `nestjs-reviewer`), pre-MR | Инварианты Pharmacy, безопасность, модули, тесты, формат и VERDICT |
| [nestjs-testing-unit-basics.md](nestjs-testing-unit-basics.md) | Unit-тесты сервисов | Jest, `Test.createTestingModule`, паттерны тестов сервисов |
| [nestjs-testing-unit-controllers.md](nestjs-testing-unit-controllers.md) | Unit-тесты контроллеров | Тесты контроллеров, фабрики тестовых данных |
| [nestjs-testing-unit-mocks.md](nestjs-testing-unit-mocks.md) | Моки зависимостей | Моки слоя данных, Redis, HTTP, ConfigService |
| [nestjs-testing-integration-setup.md](nestjs-testing-integration-setup.md) | Интеграционные и e2e тесты | Реальная PostgreSQL, apps/api-e2e, supertest |
| [nestjs-testing-integration-patterns.md](nestjs-testing-integration-patterns.md) | Тесты auth, изоляции, пагинации | Сессии/права в тестах, изоляция тенантов, валидация, limit/offset |
| [nestjs-testing-patterns.md](nestjs-testing-patterns.md) | Тесты устойчивости и контекста | Circuit breaker, AsyncLocalStorage |
| [nestjs-testing-ci-troubleshooting.md](nestjs-testing-ci-troubleshooting.md) | Покрытие, проблемы тестов | Пороги покрытия, локальный прогон через Nx, типовые проблемы |
| [nestjs-messaging-basics.md](nestjs-messaging-basics.md) | Фоновые задачи, outbox, sync | Очереди-таблицы PostgreSQL (`SELECT … FOR UPDATE SKIP LOCKED`) вместо брокеров |
| [nestjs-observability.md](nestjs-observability.md) | Логирование, трассировка | Структурные логи встроенным `Logger` + correlation ID; OpenTelemetry — после ADR |
| [nestjs-resilience-circuit-breaker.md](nestjs-resilience-circuit-breaker.md) | Устойчивость внешних вызовов | Circuit breaker, retry, timeout для фискализации/sync |
| [nestjs-resilience-context.md](nestjs-resilience-context.md) | Контекст запроса, correlation ID | AsyncLocalStorage: tenant, employee, correlation ID |
| [nestjs-debugging-logging.md](nestjs-debugging-logging.md) | Отладка запросов | Debug-логи, логирование SQL, жизненный цикл запроса |
| [nestjs-debugging-context-di.md](nestjs-debugging-context-di.md) | Ошибки DI, контекст | Отладка DI, AsyncLocalStorage, конфиг |
| [nestjs-debugging-performance.md](nestjs-debugging-performance.md) | Утечки памяти, медленные операции | Профилирование, память, бюджет кассы ≤ 1 сек |
| [nestjs-debugging-production.md](nestjs-debugging-production.md) | Инциденты в проде / на офлайн-точке | Диагностика по логам и correlation ID |
| [nestjs-real-world-issues.md](nestjs-real-world-issues.md) | Типовые проблемы NestJS | DI, циклические зависимости, память — с решениями на Jest |
