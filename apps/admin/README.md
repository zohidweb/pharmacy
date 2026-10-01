# admin — админка оператора платформы

Next.js static export (ADR-0004), FSD (ADR-0017), UI-кит `@pharmacy/ui` (ADR-0007),
данные — TanStack Query, формы — React Hook Form + zod, i18n — use-intl (ADR-0015).

```
npx nx dev admin      # http://localhost:4300, API на моках
npx nx test admin
npx nx fsd admin
```

## Моки API

Пока `apps/api` не реализует эндпоинты оператора, `nx dev admin` запускается с
`NEXT_PUBLIC_API_MOCKS=true` (таргет `dev` в `package.json`): запросы обслуживает
`src/shared/api/mocks` по тем же маршрутам и кодам ошибок, что и будущий API. Синтетический
демо-оператор (логин и пароль) — в `src/shared/api/mocks/fixtures.ts`. Сборки (`nx build admin`)
флаг не получают: код моков в `out/` не попадает.

## i18n

Словари — `src/shared/i18n/messages/{ru,tg}.json`, ключи на английском, RU — эталон набора
ключей (тест сверяет TJ с RU). Язык выбирается переключателем RU/TJ и запоминается в браузере.
Переводы TJ требуют вычитки носителем языка.

## Маршруты

`app/` — только реэкспорты страниц из `src/pages`. Экраны входа — `app/login`, экраны после
входа — группа `app/(shell)` с каркасом `widgets/app-shell`. Каталог UI-кита — `/dev/ui-kit`
(только dev).
