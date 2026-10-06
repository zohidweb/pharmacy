# Точки и юрлица владельца — спецификация

Дата: 2026-10-06. Статус: утверждено архитектором 2026-10-06. Связано: модель данных `01-platform-org.md`
(`legal_entities`, `stores`), ADR-0013 (класс `tenant`, точки создаёт владелец), ADR-0018 (права,
охват точек), ADR-0015 (frontend, офлайн-устойчивость), ADR-0017 (FSD), спецификации
`2026-10-02-auth-design.md` (вход, активация) и `2026-10-05-tenants-module-design.md` (решение T2:
первую точку заводит владелец).

## 1. Цель и критерии успеха

Владелец новой сети после активации сам заводит первую и следующие точки вместе с юрлицами, и сеть
становится рабочей. Впервые весь путь владельца идёт по настоящему API: оператор создаёт сеть в
админке, владелец задаёт пароль кодом активации, входит, создаёт первую точку и попадает на главную.

Успех:
- новый владелец проходит путь «код активации → пароль → вход → первая точка → главная» без
  участия оператора;
- точка всегда принадлежит юрлицу сети; код точки уникален в сети; ИНН юрлица уникален среди
  активных юрлиц сети;
- повторная отправка формы создания точки не создаёт вторую точку;
- каждое изменение точки и юрлица — в журнале сети (`audit_log`);
- оператор видит новые точки в реестре карточки сети без доступа к их адресам (ADR-0013);
- `apps/web` работает в режиме `partial`: вход, активация, точки и юрлица — в API, остальные экраны —
  на моках.

## 2. Решения, принятые при обсуждении (2026-10-06)

| # | Вопрос | Решение |
|---|---|---|
| S1 | Объём | API юрлиц и точек и перевод на настоящий API той части web, которая нужна владельцу: вход, активация, первая точка, страница «Точки» (режим `partial`, как в админке) |
| S2 | Где заводится юрлицо | В форме точки: выбор существующего или «Новое юрлицо» (название, ИНН, юр. адрес). Отдельного экрана юрлиц нет; в API — свои маршруты `/legal-entities` |
| S3 | Состав полей точки | По модели данных: название, код, адрес, тип, юрлицо, «печатать чек сразу». Телефон, управляющий, минимальный остаток, шапка и подвал чека уходят из контракта и формы web — вернутся со своими модулями |
| S4 | Первый вход без точек | Экран «Первая точка» вместо выбора рабочей точки: одна форма юрлица и точки, после сохранения точка становится рабочей |
| S5 | Повтор создания точки | Идемпотентность по `Idempotency-Key`: ключ хранится в строке `stores` (уникальный индекс), повтор возвращает ту же точку |

## 3. API (`apps/api/src/app/stores`, только `TenantDatabase`)

Новый модуль `StoresModule` с двумя контроллерами. Доступ к данным — через `withTenant`, фильтр
тенанта применяет RLS (ADR-0013). Модуль не регистрируется на офлайн-точке
(`STORE_MODE=offline`): точки и юрлица ведутся только в облаке и приходят на точку лентой изменений
(ADR-0014; синхронизация — отдельной задачей).

| Маршрут | Право | Ответ |
|---|---|---|
| `GET /legal-entities` | `stores:view` | `200 LegalEntitiesResponse` — активные юрлица сети и `defaults` (название и ИНН сети из `tenants` для подсказки в форме) |
| `POST /legal-entities` | `stores:create` | `201 LegalEntity` |
| `PATCH /legal-entities/{id}` | `stores:update` | `200 LegalEntity` |
| `GET /stores` | `stores:view` | `200 StoresOverview` — точки в охвате сотрудника, сначала активные, по названию |
| `POST /stores` | `stores:create` | `201 OwnerStore`; заголовок `Idempotency-Key` (UUID) необязателен |
| `PUT /stores/{id}` | `stores:update` | `200 OwnerStore` |

Правила:
- **Юрлицо точки** при создании — ровно одно из двух: `legalEntityId` (активное юрлицо сети) или
  `newLegalEntity` (создаётся в той же транзакции, что и точка). Оба или ни одного → 400
  `validation_failed`.
- **Точка** создаётся облачной (`mode = 'online'`), `status = 'active'`; тип — `pharmacy` или
  `warehouse`. Код — `^[A-Z0-9]{1,8}$` после приведения к верхнему регистру и обрезки пробелов.
- **Правка точки** (`PUT`): название, адрес, юрлицо, «печатать чек сразу». Код и тип после создания не
  меняются (код входит в номера документов). Смена юрлица разрешена, пока документов нет; ограничение
  вводит первый модуль документов. Закрытую точку менять нельзя → 409 `store_closed`.
- **Охват.** `GET /stores` и `PUT /stores/{id}` видят только точки охвата сотрудника; точка вне
  охвата → 404. Юрлица — общие для сети. Сотрудник с охватом-списком, создавший точку, не получает её
  в охват автоматически: охват выдаёт владелец (ADR-0018, запрет эскалации). Охват «вся сеть» видит
  новую точку сразу (охват вычисляется при чтении).
- **Идемпотентность.** `POST /stores` с ключом, который уже есть у точки этой сети, возвращает эту
  точку (`201`, тот же ответ) и ничего не пишет. Запрос без ключа выполняется как обычно. Гонка двух
  одинаковых запросов разрешается уникальным индексом: проигравший перечитывает точку по ключу.
- **Аудит.** В той же транзакции — `audit_log` сети через `AuditService`: `store.created`,
  `store.updated`, `legal-entity.created`, `legal-entity.updated`.
- **Деньги** не участвуют; оплата точек (`store_billing`) — у оператора.

## 4. Данные (миграция)

- `stores.idempotency_key uuid null` и уникальный индекс `(tenant_id, idempotency_key) where
  idempotency_key is not null`.
- Других изменений схемы нет: `legal_entities` и `stores` созданы миграцией `org-foundation`;
  `pharmacy_app` уже читает свою строку `tenants` (подсказка названия и ИНН) и пишет тенантные таблицы
  по RLS.
- Перегенерация типов Kysely (`api:db-types`); модель данных `01-platform-org.md` дополняется
  колонкой ключа.

## 5. Контракт (`libs/shared/dto`, `tenant-owner.ts`)

```ts
export type StoreKind = 'pharmacy' | 'warehouse';

export interface LegalEntity {
  id: string;
  name: string;
  /** 9 digits. */
  taxId: string;
  legalAddress: string;
  phone: string | null;
  email: string | null;
  bankDetails: string | null;
  /** Stores of the network that belong to this legal entity (any status). */
  stores: number;
}

export type LegalEntityInput = Pick<
  LegalEntity, 'name' | 'taxId' | 'legalAddress' | 'phone' | 'email' | 'bankDetails'
>;

export interface LegalEntitiesResponse {
  items: LegalEntity[];
  /** The network's own name and INN, to prefill the first legal entity. */
  defaults: { name: string; taxId: string | null };
}

export interface OwnerStore {
  id: string;
  name: string;
  code: string;
  address: string;
  kind: StoreKind;
  legalEntityId: string;
  legalEntityName: string;
  printReceiptDefault: boolean;
  mode: StoreMode;
  /** 'pending' = mode offline_pending; 'closing' is not used until store closing exists. */
  status: OwnerStoreStatus;
  paidUntil: string | null;          // null until billing for the owner exists
  licenseValidUntil: string | null;  // null until offline stores exist
  receiptsThisMonth: number;         // 0 until the POS module exists
  closedOn: string | null;
  stockMovedTo: string | null;
}

/** POST /api/v1/stores — exactly one of legalEntityId / newLegalEntity. */
export interface CreateStoreRequest {
  legalEntityId?: string;
  newLegalEntity?: LegalEntityInput;
  name: string;
  code: string;
  address: string;
  kind: StoreKind;
  printReceiptDefault: boolean;
}

/** PUT /api/v1/stores/{id} */
export interface UpdateStoreRequest {
  name: string;
  address: string;
  legalEntityId: string;
  printReceiptDefault: boolean;
}

export interface StoresOverview {
  stores: OwnerStore[];
}
```

Из контракта уходят `StoreInput`, `StoreReceiptSettings`, поля `phone`, `managerId`, `managerName`,
`minStockPacks`, `receipt` и `StoresOverview.lastImpersonation` (вход «от имени» не реализуется —
ADR-0008, поправка 2026-10-05). DTO API — с class-validator в `apps/api` по образцу модуля «сети».

## 6. Web (`apps/web`)

1. **Режим `partial`.** `NEXT_PUBLIC_API_MOCKS`: `true` — всё на моках (e2e, демо); `partial` —
   маршруты из списка `REAL_API_ROUTES` идут в API, остальные — в моки; не задана — всё в API.
   В списке — то, что API реализует: `sessions.*`, `activations.create`, `me.get`, `me.update`,
   `me.changePassword`, `me.changePin`, `me.terminals`, `terminals.current`, `terminals.unbind`,
   `terminalSessions.create`, `stores.overview`, `stores.create`, `stores.update`,
   `legalEntities.*` (точный список сверяется с контроллерами API в плане). `isApiRouteAvailable`
   скрывает действия, маршрута которых нет в текущем режиме. Новая цель `nx run web:dev-api`
   (`next dev` с `partial`, прокси `/api/*` на `:3000` как у `dev`). В `partial` экраны на моках
   показывают демо-данные со своими точками — это режим разработки.
2. **«Первый вход» (`/activate`).** Логин, код активации, новый пароль дважды → `POST /activations`
   → переход на вход с заполненным логином. Ссылка «Первый вход по коду активации» на странице
   входа. Неверный или истёкший код — одно общее сообщение (как отвечает API).
3. **«Первая точка».** В потоке входа, если у сессии нет ни одной точки: с правом `stores:create` —
   форма юрлица (подсказка из `defaults`) и точки; после `POST /stores` — `PUT
   /sessions/current/store` с новой точкой и переход на главную. Без права — «Вам ещё не назначена
   точка — обратитесь к владельцу сети» и кнопка «Выйти».
4. **«Точки».** Таблица: название, код, тип, юрлицо, режим, статус. Диалог точки: юрлицо (выбор или
   «Новое юрлицо…» с полями), название, код и тип (только при создании), адрес, «печатать чек сразу».
   «Закрыть точку» — только где маршрут закрытия доступен (полные моки).
5. **Фича `features/store-form`** — общая форма для «Первой точки» и диалога «Точки» (React Hook
   Form + zod, ADR-0015), один `Idempotency-Key` на открытую форму.
6. **Моки** переводятся на новый контракт (точки, юрлица, `defaults`, ошибки 409). Тексты RU/TJ.
   Существующие юнит-тесты и e2e, проверяющие старые поля формы точки, правятся.

## 7. Ошибки

| Статус | Коды |
|---|---|
| 404 | `not_found` — точка вне охвата или нет, юрлицо нет или в архиве |
| 409 | `store_code_taken`, `tax_id_taken`, `store_closed` |
| 400 | `validation_failed` с `errors[]`: ИНН — 9 цифр; название точки и юрлица — 1–120 символов; адрес и юр. адрес — 1–300; банковские реквизиты — до 1000; телефон — E.164; e-mail — формат; код — `^[A-Z0-9]{1,8}$`; ровно одно из `legalEntityId` / `newLegalEntity` |

Web показывает конфликты у своих полей (код точки, ИНН), остальное — общим сообщением с
correlation ID (как админка).

## 8. Вне объёма

Закрытие точки (после модуля перемещений); выпуск и перевод в офлайн (ADR-0014); архив юрлиц и
закрытый период (`closed_until`); оплата и лицензии в карточке точки; синхронизация точек и юрлиц на
офлайн-точку; назначение сотрудников на точки (модуль сотрудников); остальные экраны web на API.

## 9. Документы

CLAUDE.md — модуль `stores` в структуре `apps/api`, `web:dev-api` в командах; модель данных
`01-platform-org.md` — ключ идемпотентности; справочники скилов `nestjs-api` и `react-dev` — модуль
точек и режим `partial` web. ADR не нужен: новых технологий, интеграций и классов доступа нет.

## 10. Проверка

Новые автотесты не пишутся до MVP (решение 2026-10-05); существующие наборы — зелёные. Ручная
проверка:
- curl: создание юрлица и точки, точка с новым юрлицом, повтор с тем же ключом → та же точка, дубль
  кода → 409 `store_code_taken`, дубль ИНН → 409 `tax_id_taken`, правка, точка вне охвата → 404,
  записи `audit_log`;
- сквозной сценарий в браузере: оператор создаёт сеть в админке (`admin:dev-api`) → владелец
  проходит «Первый вход» в web (`web:dev-api`) → вход → «Первая точка» → главная → «Точки»: вторая
  точка с новым юрлицом → карточка сети в админке показывает обе точки.
