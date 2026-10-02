---
name: web-performance-optimization
description: "Optimize performance of the Pharmacy Next.js (React, TypeScript) static-export SPA apps in the Nx monorepo (apps/web, apps/admin): cashier (POS) responsiveness and INP on barcode scanning, catalog search, receipt printing, Core Web Vitals (LCP, INP, CLS), client bundle size and code splitting (next/dynamic, React.lazy, Suspense), memoization driven by React Profiler data, long lists (catalog, stock, reports), self-hosted next/font with Cyrillic/Tajik glyphs, next/image in output: 'export'. Use when the касса/склад/отчёты UI feels slow, a bundle grew, before a Lighthouse audit, or when tuning for weak POS hardware — always measure with profiling tools before making changes. Ключевые слова: производительность, тормозит касса, сканер штрих-кода, размер бандла."
risk: low
source: "adapted from kumaran-is/claude-code-onboarding (MIT), develop@a7f2fc5 — original: Angular 21.x; rewritten for Next.js/React (Pharmacy)"
date_added: "2026-02-27"
updated: "2026-09-29"
last-reviewed: "2026-09-29"
allowed-tools: "Read, Grep, Glob, Bash, Edit, Write"
metadata:
  related-skills: [react-dev, tailwind-patterns, ui-standards-tokens]
---

## Pharmacy: контекст и ограничения

Скил переписан с Angular 21 на стек Pharmacy с сохранением методологии оригинала: «сначала измерь,
потом оптимизируй», Core Web Vitals, чек-листы. Источники истины — `CLAUDE.md` монорепо
`pharmacy` (ADR-0010),
`docs/architecture/stack.md`, `docs/architecture/c4/deployment.md`. Конвенции React — скил `react-dev`
(этот скил ему не противоречит и не дублирует его).

**Что зафиксировано и учтено:**
- `apps/web` (касса, склад, кабинет владельца) и `apps/admin` — Next.js в режиме static export
  (`output: 'export'`). **SSR, ISR, RSC-фетчинг на сервере, Server Actions, Route Handlers с логикой,
  middleware не используются** — серверного рантайма Next.js в проде нет. Статику отдаёт reverse proxy,
  данные — только REST `apps/api` (`/api/v1/…`). Всё про TransferState/гидратацию SSR/streaming из
  оригинала удалено: оптимизируем клиентский бандл и рантайм в браузере.
- Главная метрика — **отзывчивость кассы: операция ≤ 1 сек end-to-end** (ТЗ). Критичные сценарии:
  сканирование штрих-кода (USB HID = очень быстрый «клавиатурный» ввод + Enter), поиск по каталогу,
  проведение чека, печать чека 58/80 мм через печать браузера.
- Целевые устройства: POS-терминалы/ПК точки, **Chrome/Edge последние 2 версии**, сенсорный экран
  от 10″, часто слабое железо и нестабильная связь (буфер перебоев — очередь операций в браузере,
  IndexedDB). Офлайн-точка: браузер → `localhost` на том же ПК, где крутятся Docker, API и PostgreSQL —
  там узкое место CPU/RAM, а не сеть.
- Шрифты — только self-hosted (`next/font/local`), нужны кириллица **и** таджикские буквы
  (ҳ ҷ ӣ қ ӯ ғ — они в диапазоне `cyrillic-ext`, а не в базовом `cyrillic`).
- Команды — через Nx: `npx nx build web|admin`, `npx nx serve web|admin`, `npx nx affected -t build test lint`.

**Требует согласования / ADR через `/03-adr` до использования** (новые зависимости = решение команды,
лицензия проверяется, см. «AI usage rules» в CLAUDE.md монорепо):
- `@next/bundle-analyzer` (dev-зависимость) — согласовать; до этого — Coverage в DevTools и размеры чанков.
- `web-vitals` (npm) — согласовать. Сбор RUM-метрик в проде — мониторинг **не выбран**,
  вводится через ADR; до него — только разовые замеры на test/локально. Метрики отправляются
  **только на собственный `apps/api`**, без ПДн и без внешних SaaS (правило проекта про данные).
- Библиотека виртуализации списков (`@tanstack/react-virtual`, `react-window` и т.п.) — ADR.
- Обёртки IndexedDB (`idb`, Dexie), библиотеки состояния/кэша данных (TanStack Query, Zustand…),
  библиотеки графиков для отчётов, React Compiler (`babel-plugin-react-compiler`) — ADR.
- Service Worker / PWA-кэширование оболочки приложения — архитектурное решение, ADR.
- Tailwind CSS — не в stack.md (см. `tailwind-patterns`, там же пометка про ADR).

**Запрещено:** CDN и внешние сервисы (Google Fonts в рантайме, image-CDN, внешняя аналитика, Sentry,
Datadog RUM, PageSpeed-мониторинг с отправкой данных), Vercel-специфика (Vercel Analytics, Speed
Insights, Edge). Персональные и клиентские данные не отправляются во внешние SaaS (правило проекта).

---

## Iron Law

**NO PERFORMANCE OPTIMIZATION WITHOUT MEASURING FIRST — сначала профиль (DevTools Performance /
React Profiler / Lighthouse на production-сборке `npx nx build web`), потом одна правка, потом повторный замер.**

Каждое изменение — с метрикой «до/после». Не оптимизировать «на глаз» и никогда не мерить в
`nx serve` (dev-режим React в разы медленнее и искажает картину).

# Web Performance Optimization — Next.js static export (Pharmacy)

## Overview

Помогает находить и устранять узкие места производительности в `apps/web` и `apps/admin`: время до
готовности кассы к работе, отзывчивость на вводе (INP), стабильность вёрстки (CLS), размер клиентского
JS, поведение длинных списков и печати на слабых POS-ПК. Все приёмы — клиентские: code splitting,
разбиение состояния, мемоизация по данным профайлера, локальные индексы/кэш каталога, пагинация.

## When to Use This Skill

- Касса «подтормаживает» при сканировании или наборе в поиске; операция > 1 сек
- Долгий первый запуск кассы / склада после входа или перезагрузки страницы
- Вырос бандл после добавления зависимости или импорта из `libs/*`
- Длинные таблицы (каталог, остатки по партиям, отчёты) лагают при прокрутке или фильтрации
- Печать чека открывается с задержкой или подвешивает интерфейс
- Прыгает вёрстка при загрузке (CLS), «мигают» шрифты, таджикские буквы рисуются другим шрифтом
- Подготовка к приёмке / аудиту производительности production-сборки

## How It Works

### Step 1: Measure Current Performance

Только production-сборка, в условиях, близких к точке:

- `npx nx build web` → раздать каталог статического экспорта (обычно `apps/web/out`; точный путь —
  `npx nx show project web` / `next.config.js`) любым статическим сервером, уже доступным в
  воркспейсе, или стендом test-среды за reverse proxy.
- **Chrome DevTools → Performance**: запись сценария «скан → строка чека → оплата → печать» с
  CPU throttling 4×–6× (имитация слабого POS). Смотреть long tasks (> 50 мс), Interactions (INP), Layout Shifts.
- **Lighthouse в DevTools**: Navigation — для загрузки страницы; **Timespan** — для пользовательского
  потока (сканирование, поиск) после входа, т.к. страницы кассы за авторизацией.
- **React DevTools Profiler** (расширение браузера): какие компоненты и почему перерисовываются на
  каждый скан/символ. Для профайла production-сборки — `next build --profile` (прокинуть в Nx-таргет).
- **DevTools → Coverage**: сколько загруженного JS не выполняется на старте кассы.
- **Network**: время ответов `/api/v1/…` — часть бюджета ≤ 1 сек; медленный API — это `nestjs-api`
  / `postgres-best-practices`, а не фронтенд.
- Пользовательские метки `performance.mark/measure` вокруг операций кассы (без зависимостей) — см. reference.

### Step 2: Identify Issues

Типичные узкие места Pharmacy:

- `setState` на каждый символ сканера/поиска в состоянии, от которого зависит весь экран кассы
- Один большой React Context («всё состояние кассы») → любое изменение перерисовывает всё дерево
- Линейный поиск по массиву каталога при каждом скане вместо индекса `Map<barcode, product>`
- Запрос к API на каждое нажатие клавиши в поиске (нет debounce и отмены предыдущего запроса)
- Тяжёлые модули в корневом layout/провайдерах: графики отчётов, словари обеих локалей,
  админские экраны — попадают в first-load JS каждой страницы
- `libs/shared/dto` с классами `class-validator`/`class-transformer` импортируется в web значениями →
  валидационные библиотеки бэкенда уезжают в клиентский бандл
- Рендер тысяч строк таблицы остатков/отчёта целиком
- Печать чека: печатается всё приложение (тяжёлый layout) вместо маленького контейнера чека
- Шрифт без `cyrillic-ext` → таджикские буквы из fallback-шрифта, скачки метрик (CLS)

### Step 3: Prioritize Optimizations

1. **Отзывчивость кассы (INP)** — скан и поиск без лишних рендеров, локальный индекс каталога
2. **First-load JS кассы** — лёгкий общий layout, `next/dynamic` для тяжёлого и редкого
3. **Длинные списки** — пагинация limit/offset (API) → `content-visibility` → виртуализация (ADR)
4. **Печать чека** — отдельный минимальный print-контейнер
5. **Шрифты и изображения** — `next/font/local` с нужным subset, размеры у `<img>`/`next/image`

### Step 4: Implement Optimizations

По одной правке в порядке приоритета, с замером после каждой. Конвенции кода — `react-dev`.

### Step 5: Verify Improvements

- Повторить ту же запись Performance с тем же throttling — сравнить long tasks и INP
- Сравнить размеры чанков статического экспорта до/после (скрипт бюджета — в reference)
- Проверить CLS: DevTools → Rendering → Layout Shift Regions
- Проверить на реальном POS-ПК точки (или самом слабом доступном), Chrome и Edge
- Для офлайн-точки — замер при работающих рядом Docker/API/PostgreSQL на том же ПК

---

## Examples

> Полные примеры с кодом «до/после» — в [references/optimization-checklists.md](references/optimization-checklists.md).

- **Example 1:** INP кассы при сканировании штрих-кода — буфер сканера без рендеров, индекс каталога, замер `performance.measure`
- **Example 2:** Поиск по каталогу — `useDeferredValue`, debounce + `AbortController`
- **Example 3:** Сокращение бандла — `next/dynamic`, `import type` из `libs/shared/dto`, локали по требованию, бюджет размера
- **Example 4:** Длинные списки — пагинация, `content-visibility`, виртуализация (только после ADR)
- **Example 5:** Печать чека и шрифты/изображения в static export

---

## Best Practices

### Do This

- **Measure First** — Performance/Profiler/Lighthouse на production-сборке до любых правок
- **Колоцируйте состояние** — состояние поля поиска/буфер сканера живёт в своём компоненте или `useRef`, а не в общем состоянии экрана
- **Дробите контексты** — отдельные контексты для редко и часто меняющихся данных; значение контекста стабилизировать
- **Индексируйте каталог** — `Map` по штрих-коду/id строится один раз при загрузке/обновлении кэша каталога и цен
- **Срочное vs несрочное** — добавление строки в чек — срочное обновление; фильтрация больших списков — через `useDeferredValue`/`startTransition`
- **Debounce только ручного ввода** (≈200–300 мс) + отмена предыдущего запроса `AbortController`; скан не дебаунсить
- **Code splitting** — Next.js сам делит по маршрутам; тяжёлые и редкие виджеты (графики отчётов, импорт/экспорт 1С, редакторы) — через `next/dynamic` или `React.lazy` + `Suspense`
- **`import type`** для типов из `libs/shared/dto`/`libs/shared/domain` в web/admin
- **Мемоизация по данным** — `React.memo`/`useMemo`/`useCallback` добавлять, когда Profiler показал лишние рендеры дорогого компонента; стабильные `key` (id товара/партии, не индекс)
- **Нативные API вместо библиотек** — `Intl.NumberFormat`/`Intl.DateTimeFormat` (через `libs/shared/util`), `structuredClone`, `Set`
- **Кэш статики на proxy** — хешированные `/_next/static/*`: `Cache-Control: public, max-age=31536000, immutable`; HTML — `no-cache` (настраивается в reverse proxy, согласовать с владельцем развёртывания)
- **Размеры медиа** — `width`/`height` или `aspect-ratio` у каждого изображения; скелетоны правильной высоты

### Do Not Do This

- **Не мерить в `nx serve`** и не оптимизировать без профиля
- **Не мемоизировать всё подряд** — `useMemo`/`React.memo` без доказанной пользы усложняют код и сами стоят времени
- **Не вводить SSR-приёмы** — `getServerSideProps`, Server Actions, серверные компоненты с фетчингом, ISR, middleware не работают в static export
- **Не тянуть тяжёлое в корневой layout/провайдеры** — это попадает в каждую страницу
- **Не дробить слишком мелко** — чанки в единицы КБ дают больше запросов, чем экономии
- **Не блокировать главный поток** — синхронная обработка всего каталога, большие `JSON.parse`/сериализация в IndexedDB на каждом скане
- **Не подключать внешние скрипты** — аналитика, шрифты с CDN, виджеты: запрещено правилом проекта про данные и вредит старту
- **Не добавлять зависимость «для скорости»** без согласования/ADR (виртуализация, state-менеджеры, IndexedDB-обёртки)

---

## Common Pitfalls

### Problem: На машине разработчика быстро, на кассе точки — медленно
**Symptoms:** Lighthouse зелёный на ноутбуке, кассир жалуется на задержку после скана
**Solution:**
- Записывать Performance с CPU throttling 4×–6×; проверять на реальном POS-ПК
- Искать long tasks после события `keydown`/`Enter` сканера — кто их порождает (Profiler: «Why did this render?»)
- На офлайн-точке учитывать, что CPU делят браузер, Docker, API и PostgreSQL

### Problem: Каждый скан перерисовывает весь экран кассы
**Symptoms:** в Profiler на один скан — десятки коммитов (по коммиту на символ) и рендер всего дерева
**Solution:**
- Буфер сканера в `useRef`, обработка только по `Enter` — ноль рендеров на символ (Example 1)
- Строки чека — отдельный компонент со стабильными props; при подтверждённой проблеме — `React.memo`
- Разделить контекст кассы на части (чек, смена/кассир, справочники)

### Problem: Бандл кассы вырос после импорта из libs
**Symptoms:** first-load JS вырос на десятки КБ; в Coverage видны `class-validator`, `validator`, `reflect-metadata`
**Solution:**
- В web/admin импортировать контракты как типы: `import type { CreateReceiptDto } from '@pharmacy/shared-dto'` (имя алиаса — по `tsconfig.base.json`)
- Если нужны значения (enum, константы) — держать их в модуле без декораторов; изменение границ lib обсуждать с командой (при смене границ модулей — ADR)
- Проверить, что libs ESM и без побочных эффектов на верхнем уровне (tree shaking)

### Problem: Таблица остатков/отчёта на тысячи строк лагает
**Symptoms:** долгий первый рендер, рывки при прокрутке и фильтрации
**Solution:** серверная пагинация limit/offset (стандарт API) → `content-visibility: auto` для блоков →
виртуализация только после ADR на библиотеку (Example 4)

### Problem: Печать чека подвешивает интерфейс
**Symptoms:** между «Оплатить» и диалогом печати — заметная пауза, в Performance — долгий Layout/Paint
**Solution:** печатать отдельный минимальный контейнер (portal вне корня приложения), корень
приложения в `@media print` — `display: none`; дождаться `document.fonts.ready` перед `window.print()` (Example 5)

### Problem: Таджикские буквы другим шрифтом, скачок вёрстки
**Symptoms:** «ҳ, ҷ, ӣ, қ, ӯ, ғ» выглядят иначе, чем остальной текст; CLS после загрузки шрифта
**Solution:** шрифтовой файл должен содержать `cyrillic-ext` (U+0460–052F); `next/font/local` с
`display: 'swap'` и fallback-метриками; проверить DevTools → Elements → Computed → Rendered Fonts

### Problem: `next/image` ломает `next build` в static export
**Symptoms:** ошибка сборки о несовместимости Image Optimization с `output: 'export'`
**Solution:** `images: { unoptimized: true }` в `next.config.js` (или кастомный `loader`, но свой
сервер изображений = новый компонент → ADR); оптимизировать файлы заранее, задавать `width`/`height`

---

## Performance Checklist

> Полный чек-лист (касса, бандл, списки, изображения и шрифты, CSS, Core Web Vitals, офлайн) — в [references/optimization-checklists.md](references/optimization-checklists.md).

**Critical items:**
- [ ] Скан штрих-кода: ноль React-рендеров на символ, поиск товара по индексу, строка чека < 100 мс на throttled CPU
- [ ] Операция кассы (скан → строка; оплата → чек) укладывается в ≤ 1 сек end-to-end на целевом железе
- [ ] Корневой layout и провайдеры не тянут тяжёлые/редкие модули; они за `next/dynamic`/`React.lazy`
- [ ] Типы из `libs/shared/dto` импортируются через `import type`; в бандле web нет `class-validator`
- [ ] Длинные списки — пагинация или `content-visibility`; виртуализация — только после ADR
- [ ] Шрифты self-hosted через `next/font/local`, в файле есть `cyrillic-ext`
- [ ] Никаких внешних скриптов, CDN и сторонней аналитики

---

## Performance Tools

> Полный перечень с пометками о согласовании — в [references/optimization-checklists.md](references/optimization-checklists.md).

- **Chrome/Edge DevTools** — Performance (long tasks, Interactions, CPU throttling), Lighthouse (Navigation/Timespan), Coverage, Rendering → Layout Shift Regions
- **React DevTools Profiler** — причины рендеров; `next build --profile` для профиля production-сборки
- **`performance.mark/measure`, `PerformanceObserver`** (`event`, `long-animation-frame`) — встроены в Chrome/Edge, без зависимостей
- `npx nx build web` + размеры чанков статического экспорта; `@next/bundle-analyzer` — **после согласования**

---

## Related Skills

- `react-dev` — конвенции React проекта: структура `features/`/`shared/`, нейминг, тесты, correlation ID, обработка ошибок
- `ui-standards-tokens` — дизайн-токены и UI-стандарты общего кита `libs/ui` (сенсорные экраны от 10″)
- `tailwind-patterns` — паттерны Tailwind CSS; **Tailwind не выбран в stack.md → только после ADR**
- `nestjs-api`, `postgres-best-practices` — если узкое место во времени ответа `apps/api`/БД

---

## Additional Resources

- [Next.js Static Exports](https://nextjs.org/docs/app/guides/static-exports) — что поддерживается в `output: 'export'`
- [next/dynamic и lazy loading](https://nextjs.org/docs/app/guides/lazy-loading)
- [next/font](https://nextjs.org/docs/app/api-reference/components/font) — `next/font/local`
- [React: useDeferredValue, startTransition, memo](https://react.dev/reference/react)
- [React Profiler](https://react.dev/reference/react/Profiler)
- [Core Web Vitals](https://web.dev/articles/vitals) и [Optimize INP](https://web.dev/articles/optimize-inp)

---

**Key principle:** сначала измерь. Одна запись DevTools Performance сценария кассы на throttled CPU
плюс React Profiler показывают реальное узкое место за 5 минут — всё остальное без них догадки.
