> **Pharmacy:** адаптировано под стек Pharmacy — Prisma middleware и Bull-процессоры удалены; контекст восстанавливается в воркерах очереди-таблицы и cron; DI-примеры на модулях api; конфигурация через `@nestjs/config`. Ограничения: `CLAUDE.md`.

# NestJS Debugging — Context, DI & Configuration

## 1. Потеря контекста (AsyncLocalStorage)

Реализация контекста — `nestjs-resilience-context.md`. Потеря контекста в Pharmacy опасна: без `tenantId` слой данных обязан **отказать** (fail closed), а не выполнить запрос без фильтра.

| Где теряется | Почему | Решение |
|---|---|---|
| `@Cron` / `@Interval` (`@nestjs/schedule`) | Нет HTTP-запроса — контекст не создавался | Обернуть тело в `runWithContext({ correlationId: randomUUID() }, …)`; tenant-задачи — ставить в очередь, а не выполнять в cron |
| Воркер очереди-таблицы | Задача выполняется позже, в другом «запросе» | Восстановить из строки задачи: `correlation_id`, `tenant_id` (`nestjs-messaging-basics.md`) |
| Таймеры/слушатели, созданные при старте | Колбэк привязан к контексту момента регистрации (пустому) | Создавать контекст внутри колбэка; `setTimeout` из запроса контекст сохраняет |
| Сторонние колбэк-API | Некоторые пулы/эмиттеры теряют async-цепочку | Обернуть: `AsyncResource.bind(fn)` из `node:async_hooks` |

Проверка в слое доступа к данным (ORM-независимо):

```typescript
// apps/api/src/common/data-access/tenant-scope.ts
export function tenantScopeOrFail(): string {
  const tenantId = getTenantId();
  if (!tenantId) {
    // Log once with correlationId; never fall back to an unscoped query.
    throw new TenantContextMissingError();
  }
  return tenantId;
}
```

Для RLS `tenantId` передаётся в БД в начале каждой транзакции: `SELECT set_config('app.tenant_id', $1, true)` (эквивалент `SET LOCAL`). Параметр `is_local = true` действует только до конца транзакции — поэтому только внутри `DatabaseService.tenantTransaction()` (`nestjs-config-data-access.md`), иначе на пуле соединений тенант «протечёт» или потеряется.

## 2. Отладка DI

```typescript
// «Nest can't resolve dependencies of ReceiptsService (?, StockMovementsRepository)»
// ? — first constructor parameter (index 0) is missing in the module scope.

// BAD: InventoryModule exports nothing, PosModule tries to inject BatchesService
@Module({ providers: [BatchesService, BatchesRepository] })
export class InventoryModule {}

// GOOD: export only the public API of the module (service), keep the repository internal
@Module({
  providers: [BatchesService, BatchesRepository],
  exports: [BatchesService],
})
export class InventoryModule {}

@Module({ imports: [InventoryModule], providers: [ReceiptsService], controllers: [ReceiptsController] })
export class PosModule {}
```

- Модули api общаются через публичные интерфейсы (экспортируемые сервисы), не через чужие репозитории/таблицы.
- Интерфейсные порты (адаптер фискализации) — `Symbol`-токен + `@Inject(TOKEN)`, реализация через `useClass` (`nestjs-rest-services.md`).
- `exports: [SomeModule]` вместо сервиса — частая ошибка (см. `nestjs-real-world-issues.md`).

### Циклические зависимости

```typescript
// BAD: pos ↔ returns import each other's services
// GOOD (preferred): extract the shared part (e.g. receipt read-model) into a third provider/module,
// or make one side depend on a narrow port instead of the whole service.
// forwardRef() on both sides — last resort only; it hides a boundary problem.
```

Граница модулей дополнительно охраняется ревью зависимостей (ADR-0002) и `@nx/enforce-module-boundaries` на уровне libs.

### Опциональные зависимости

`@Optional()` не применяйте для обязательных интеграций. Адаптер фискализации всегда предоставлен (в MVP — заглушка), выбор реализации — через конфигурацию модуля fiscal, а не через «может быть undefined».

## 3. Конфигурация и переменные окружения

- API читает конфигурацию через `@nestjs/config` из `.env` (в `.gitignore`); в git — только `.env.example`. Детали — `nestjs-config-basics.md`.
- На MVP секреты — переменные окружения среды деплоя (категория «Управление секретами» — на утверждении).
- Отсутствующая обязательная переменная — падение при старте (fail fast), а не `undefined` в рантайме.

```bash
# Check whether a variable is set — without printing its value
node -e "console.log('DATABASE_URL set:', Boolean(process.env.DATABASE_URL))"
```

Никогда не выводите `process.env` целиком (в лог, консоль, ответ API) — там строки подключения и ключи.

Приоритет: переменные окружения процесса > `.env` > значения по умолчанию в схеме конфигурации.

## 4. Troubleshooting

| Проблема | Симптом | Решение |
|---|---|---|
| Маршрут не найден | 404 на существующий эндпоинт | Модуль импортирован в `AppModule`; нет двойного префикса `api/v1` |
| Валидация не работает | Невалидные данные проходят | Глобальный `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`; декораторы class-validator в DTO из `libs/shared/dto` |
| Циклическая зависимость | Ошибка инициализации модулей | Выделить общий модуль/порт; `forwardRef` — крайний случай |
| Контекст потерян | `requireTenantId()` бросает в фоне | См. таблицу раздела 1 |
| RLS возвращает пусто | Запросы без строк при верных данных | `app.tenant_id` не установлен в текущей транзакции; `set_config` вызван на другом соединении пула |
| Исчерпан пул соединений | Запросы висят | Незакрытые транзакции; долгие внешние вызовы внутри транзакции (выносить за транзакцию); размер пула vs число инстансов |
| Cron выполняется N раз | Дубли задач | Каждый инстанс запускает cron — ставить задачу с idempotency key периода |
| Задача «висит» в `processing` | Не завершается | Воркер упал — `releaseStale()`; проверить таймаут внешнего вызова |
| Конфиг `undefined` | Значение не читается | Имя переменной, наличие в `.env`, схема валидации конфига |
