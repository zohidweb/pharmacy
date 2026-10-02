> **Pharmacy:** адаптировано под стек Pharmacy — решения на Jest (стандарт Nx) вместо Vitest; Prisma- и JWT-специфика удалены (доступ к данным — Kysely, ADR-0006; аутентификация — серверные сессии, ADR-0008); добавлены типичные проблемы Jest + Nest в Nx. Ограничения: `CLAUDE.md`. <!-- docs-check: ok -->

# NestJS Real-World Issues — GitHub & Stack Overflow Reference

Частые проблемы уровня фреймворка NestJS (по GitHub issues и Stack Overflow) с порядком проверенных решений.

---

## DI & Module Resolution

### "Nest can't resolve dependencies of the [Service] (?)"
**Частота**: HIGHEST (500+ GitHub issues) | **Сложность**: LOW-MEDIUM
**Источники**: GitHub #3186, #886, #2359 | SO 75483101

1. Провайдер есть в `providers` модуля.
2. При пересечении границы модулей — провайдер в `exports` модуля-владельца, модуль-владелец в `imports` потребителя.
3. Опечатки в имени/токене провайдера (GitHub #598 — сообщение может вводить в заблуждение).
4. **Порядок реэкспортов в barrel-файлах (`index.ts`)** — может давать циклическое разрешение и `undefined` вместо класса (GitHub #9095).

Вариант проекта: не резолвится `TenantDatabase` / `RedisService` — они в глобальных `DatabaseModule` / `RedisModule` (`nestjs-templates-core.md`); в unit-тесте их нужно подставить моками явно (глобальные модули в `Test.createTestingModule` не подтягиваются сами). `PlatformDatabase` не глобальный: модуль платформы импортирует `PlatformDatabaseModule` явно.

---

### "Circular dependency detected"
**Частота**: HIGH | **Сложность**: HIGH
**Источники**: SO 65671318 | обсуждения GitHub

Порядок решений:
1. **Вынести общую часть в третий модуль/провайдер** — цикл обычно сигнал нарушенной границы (в модульном монолите границы модулей охраняются, ADR-0002).
2. Зависеть от узкого интерфейса, а не от всего сервиса другого модуля.
3. `forwardRef()` на **обеих** сторонах — крайний случай, он маскирует проблему дизайна.

```typescript
// Last resort only
@Injectable()
export class ReceiptsService {
  constructor(@Inject(forwardRef(() => ReturnsService)) private readonly returns: ReturnsService) {}
}
```

---

### Модуль экспортирует сам себя вместо сервиса
**Частота**: MEDIUM | **Сложность**: LOW | **Источник**: GitHub #866

```typescript
// BAD
@Module({ providers: [BatchesService], exports: [InventoryModule] })
export class InventoryModule {}

// GOOD
@Module({ providers: [BatchesService], exports: [BatchesService] })
export class InventoryModule {}
```

Ищите `exports: [SomeModule]`, где `SomeModule` — объявляемый модуль.

---

### "(?, +)" в сообщении об ошибке
**Частота**: HIGH | **Сложность**: LOW | **Источник**: GitHub #886

- `?` — не найден провайдер на этой позиции параметра конструктора; `+` — найден.
- Позиция `?` = индекс параметра; проверьте `@Injectable()` на классе и регистрацию токена.
- Для интерфейсных портов (например, `FISCAL_REGISTRAR`) нужен `@Inject(TOKEN)` — интерфейсы TypeScript в рантайме не существуют.

---

### Почему ошибки DI такие общие
**Источник**: GitHub #223 (feature request, поведение намеренное)

Локально: `NestFactory.create(AppModule, { logger: ['verbose', 'debug', 'log', 'warn', 'error'] })`; явные `@Inject()`-токены с говорящими именами.

---

## Testing (Jest + `@nestjs/testing` в Nx)

### Тестовый модуль не резолвит зависимости
**Частота**: HIGH | **Сложность**: MEDIUM | **Источники**: SO 75483101, 62942112, 62822943

1. Каждую зависимость сервиса — явно в `providers` через `{ provide: Token, useValue: mock }`.
2. Не импортировать в unit-тест реальные модули с инфраструктурой (БД, Redis) — только моки.
3. Если модуль импортирован целиком — `overrideProvider(Token).useValue(mock)`.
4. Слой данных — мок `TenantDatabase` + репозиториев (`nestjs-testing-unit-mocks.md`); реальная БД — только в интеграционных тестах (`*.int-spec.ts`) и e2e.

```typescript
beforeEach(async () => {
  const moduleRef = await Test.createTestingModule({
    providers: [
      ReceiptsService,
      { provide: TenantDatabase, useValue: db },   // db.tenantTransaction = (work) => work(fakeTrx)
      { provide: ReceiptsRepository, useValue: { findByIdempotencyKey: jest.fn(), insert: jest.fn() } },
      { provide: FISCAL_REGISTRAR, useValue: { register: jest.fn() } },
    ],
  }).compile();
  service = moduleRef.get(ReceiptsService);
});
```

### Метаданные декораторов не генерируются
Симптом: DI получает `undefined`, `design:paramtypes` отсутствует. Решение: `emitDecoratorMetadata` и `experimentalDecorators` в `tsconfig.spec.json`; transform `ts-jest` из Nx-пресета (не заменять на транспилятор без поддержки метаданных).

### "Jest did not exit one second after the test run has completed"
Открытые хэндлы: `app.close()`, пул БД, Redis-клиент, таймеры `@nestjs/schedule` в `afterAll`. Диагностика — `npx nx test api --detectOpenHandles`.

### "Cannot find module '@pharmacy/…'"
Путь не объявлен в `tsconfig.base.json` → `paths` или jest-конфиг проекта не наследует `jest.preset.js` Nx.

---

## Configuration

### Обязательная переменная окружения отсутствует
**Частота**: HIGH | **Сложность**: LOW

1. Переменная есть в `.env` (корень приложения, не `src/`) или в окружении процесса.
2. `ConfigModule` инициализирован до модулей, читающих конфиг асинхронно (`forRootAsync` + `inject: [ConfigService]`).
3. Fail fast: схема конфигурации валидирует обязательные ключи при старте (`nestjs-config-basics.md`) — падение на старте, а не `undefined` в рантайме.
4. Значения секретов в лог не выводить даже при отладке.

---

## Production

### Утечки памяти
**Частота**: LOW | **Сложность**: HIGH

1. Heap snapshots: `node --inspect` + Chrome DevTools Memory.
2. **Снимать слушатели в `onModuleDestroy()`** — самый частый источник утечек в NestJS.
3. Закрывать внешние соединения (пул PostgreSQL, Redis) в `onModuleDestroy`/`onApplicationShutdown`; `app.enableShutdownHooks()`.
4. Неограниченные in-memory `Map`-кэши — заменить Redis с TTL.

```typescript
@Injectable()
export class PriceEventsService implements OnModuleDestroy {
  private readonly emitter = new EventEmitter();
  onModuleDestroy() {
    this.emitter.removeAllListeners();
  }
}
```

Подробнее — `nestjs-debugging-performance.md`.

### Регрессии после обновления версии
**Частота**: LOW | **Сложность**: MEDIUM | **Источник**: GitHub #2359

1. Issues на GitHub по конкретной версии.
2. Откат на предыдущий patch / обновление на последний patch.
3. Минимальное воспроизведение для репорта.
4. Обновления `@nestjs/*` — одной версией для всех пакетов, lock-файл в MR, `npm ci` + `npx nx affected -t build test lint`.

---

## Автомоки (`@golevelup/ts-jest`) — не используем

ADR-0009 (ось Г): моки — явные типизированные объекты `{ method: jest.fn() }` и фабрики в
`apps/api/test/mocks` / `libs/shared/testing` (`nestjs-testing-unit-mocks.md`). Автомок всех
методов скрывает, какие зависимости сервис реально вызывает.
