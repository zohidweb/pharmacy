---
name: ui-standards-tokens
description: "Design tokens and UI standards for Pharmacy web apps (Next.js/React SPA in Nx, shared kit libs/ui): primitive → semantic → component tokens as CSS custom properties (color OKLCH, typography, spacing, radius, shadow, z-index, motion), WCAG 2.1 AA, touch targets for POS / касса (≥44px, POS ≥48px), keyboard and USB barcode scanner, RU/TJ localization (ҳ ҷ ӣ қ ӯ ғ, cyrillic-ext), TJS money (сомони/дирамы, integer minor units) and dates, batch status colors (истекает срок / просрочено), 58/80 mm receipt print styles. Use when creating or reviewing UI components and styles in apps/web, apps/admin, libs/ui, defining themes, or auditing hardcoded hex/rgb/px (токены, дизайн-система, доступность, печать чека)."
allowed-tools: Read, Grep, Glob
metadata:
  triggers: design tokens, CSS custom properties, libs/ui, UI kit, theming, accessibility, WCAG, color contrast, touch target, POS UI, касса, токены, доступность, печать чека, receipt print, RU/TJ, TJS money format, token compliance audit
  related-skills: tailwind-patterns, react-dev, web-performance-optimization
  domain: frontend
  role: specialist
  scope: design
  output-format: document
source: "adapted from kumaran-is/claude-code-onboarding (MIT), develop@a7f2fc5"
last-reviewed: "2026-10-02"
---

## Pharmacy: контекст и ограничения

Оригинал был написан для мобильного стека — переписан под веб-стек Pharmacy (React, CSS custom properties).

- **Стек** (корневой CLAUDE.md репозитория `pharmacy`;
  `docs/architecture/stack.md`): Nx-монорепо, `apps/web` (касса, склад, кабинет владельца) и `apps/admin`
  (админка оператора) — Next.js (React, TypeScript strict) в режиме SPA/static (`output: 'export'`, без SSR).
  Общий UI-кит — `libs/ui`; деньги, даты, i18n — `libs/shared/util`.
- **Источник истины токенов — CSS custom properties в `libs/ui`** (префикс `--ph-`).
- **ADR-0007:** утилиты Tailwind CSS v4 генерируются только из этих токенов (`@theme inline`,
  скил `tailwind-patterns`); CSS Modules — только `ReceiptPrint` (печать чека) и `PosLayout` (сетка
  кассы). UI-кит `libs/ui` — свой, на нативной платформе: `<dialog>`, Popover API + anchor
  positioning, `<select>` с `appearance: base-select`, ARIA APG для Combobox и Tabs; иконки — свой
  SVG-набор (`libs/ui/src/lib/icon`, исходники Lucide копией с лицензией в
  `libs/ui/THIRD_PARTY_NOTICES.md`); склейка классов — `cx()`.
- **Решённые библиотеки:** i18n — use-intl (ADR-0015, `reference/ui-localization-formatting.md`);
  a11y-тесты — `jest-axe` для компонентов `libs/ui` и `@axe-core/playwright` для экранов, гейт —
  0 нарушений serious/critical (ADR-0009).
- **UI-библиотеки** (shadcn/ui, Radix, Base UI, Headless UI, MUI, Mantine…), пакеты иконок,
  stylelint-плагины и прочие новые зависимости — только через ADR команды (`/03-adr`).
  Не вводить молча.
- **Устройства** (docs/architecture/c4/deployment.md): Chrome/Edge (последние 2 версии), сенсорный
  экран от 10″ (1280×800 и выше), сканер штрих-кода USB HID, печать чеков 58/80 мм через печать браузера.
  Офлайн-точка работает без интернета → шрифты и иконки только self-hosted, никаких CDN.
- Структура кода и нейминг — по скилу `react-dev` (TypeScript, PascalCase-компоненты, английские
  идентификаторы; доменные термины — из `docs/architecture/glossary.md`).
- Аудит соответствия выполняет агент проекта `ui-standards-expert` с этим скилом.
- **Открыто / согласовать** (не выдавать за решённое): финальная палитра, лицензия шрифта TT Norms
  Pro (`libs/ui/src/styles/fonts.css` — подтвердить до релиза), обозначение валюты («смн»?) и формат
  для TJ, набор горячих клавиш кассы, тёмная тема и компактная плотность `apps/admin`.
  Статусы партий — только из `glossary.md` (срок годности партии); новые статусы (например,
  блокировка партии) не вводить, пока их нет в ТЗ и глоссарии.

---

**Iron Law 1:** В компонентах `apps/*` и `libs/ui/src/lib/**` — никаких hex/rgb/hsl/oklch-литералов,
сырых `px`/`rem`, inline `style` с визуальными значениями и «магических» z-index. Только токены `--ph-*`.
Сырые значения живут в одном месте — `libs/ui/src/styles/tokens/`.

**Iron Law 2 (token SSOT):** У каждого семейства токенов (space, size, radius, font-size, shadow, z,
duration) ровно ОДНА каноническая шкала. Не заводить параллельную «legacy»-шкалу (например,
t-shirt `sm/md/lg` рядом с числовой `1..16`). Миграция вызовов и удаление старой шкалы — в одном MR.

**Iron Law 3:** Статус никогда не передаётся только цветом — всегда иконка и/или текст
(WCAG 1.4.1). Особенно статусы партий: истекает срок / просрочено.

# UI Standards — Design Tokens & Patterns (Pharmacy)

**When to use:** создание/ревью компонентов `libs/ui` и экранов `apps/web`, `apps/admin`; определение
и изменение токенов/тем; доступность; сенсорные и клавиатурные сценарии кассы; форматы денег и дат;
печать чеков; аудит на хардкод.

## Process

1. **Определи домен** запроса.
2. **Загрузи reference:**
   - Токены (все 3 уровня), темы, плотность, шрифты, файлы в libs/ui → `reference/ui-design-tokens.md`
   - Доступность, сенсорные цели, клавиатура/сканер, статусы партий, фокус, live-регионы → `reference/ui-accessibility-patterns.md`
   - RU/TJ, длинные строки, глифы, формат TJS, дат, чисел → `reference/ui-localization-formatting.md`
   - Печать чеков 58/80 мм, `@media print` → `reference/ui-print-receipts.md`
3. **Примени паттерны** из reference.
4. **Проверь** (раздел «Verify» ниже): нет хардкода, сенсорные цели по шкале, контраст AA,
   статусы с иконкой/текстом, фокус видим, деньги форматируются только на отображении.

## Архитектура токенов (кратко)

```
primitives.css   --ph-green-700, --ph-space-4, --ph-font-size-lg …   сырые значения (OKLCH, rem)
      ↓ используются ТОЛЬКО в semantic.css / components.css
semantic.css     --ph-color-primary, --ph-color-fg, --ph-color-danger …  смысл; темы переопределяют этот слой
      ↓
components.css   --ph-button-bg-primary, --ph-batch-expired-bg …       конкретный компонент/доменный статус
      ↓
компоненты       утилиты Tailwind из @theme inline (bg-primary, p-4, rounded-(--ph-button-radius))
                 | var(--ph-…) в CSS Modules — только ReceiptPrint и PosLayout (ADR-0007)
```

| Семейство | Шкала (канон) | Где подробно |
|---|---|---|
| Цвет | примитивы OKLCH → семантика (`bg`, `surface`, `fg`, `border`, `primary`, `success/warning/danger/info/hold`) → компоненты | ui-design-tokens.md §1 |
| Отступы | `--ph-space-{0,1,2,3,4,5,6,8,10,12,16}`, база 4 px (0.25rem) | §2 |
| Размеры | `--ph-size-touch-{min,pos,primary}`, `--ph-size-row-{dense,compact}`, `--ph-size-icon-{sm,md,lg}` | §3 |
| Типографика | `--ph-font-size-{xs,sm,md,lg,xl,2xl,3xl}` + парные `--ph-line-height-*`, `--ph-font-weight-*`, `--ph-font-{sans,mono}` | §4 |
| Радиусы, рамки | `--ph-radius-{none,sm,md,lg,full}`, `--ph-border-width-{1,2}` | §5 |
| Тени | `--ph-shadow-{sm,md,lg}` | §5 |
| Z-index | `--ph-z-{base,sticky,dropdown,overlay,modal,toast,tooltip}` | §6 |
| Motion | `--ph-duration-{fast,normal,slow}`, `--ph-ease-{standard,out}`; обнуляются при `prefers-reduced-motion` | §6 |

Нейминг компонентных токенов: `--ph-{component}-{property}-{variant?}-{state?}`
(`--ph-button-bg-primary-hover`, `--ph-input-border-focus`, `--ph-table-row-height`).

## Ключевые правила Pharmacy

| Тема | Правило |
|---|---|
| Экраны | Целевой минимум 1280×800 CSS px, альбомная ориентация. Проверять и при масштабировании Windows 125 % (≈1024×640 CSS px) — раскладка не ломается. Мобильная вёрстка не цель. |
| Сенсорные цели | Базово ≥ 44×44 px (`--ph-size-touch-min`) во всём `apps/web`; касса ≥ 48 px (`--ph-size-touch-pos`); главные действия кассы (Оплатить, Отложить чек) — 64 px (`--ph-size-touch-primary`). Между целями ≥ `--ph-space-2`. |
| Плотность | `apps/web` — сенсорная плотность всегда. `apps/admin` (мышь) может включать `data-density="compact"` — предложение, согласовать с дизайном. |
| Тема | Светлая по умолчанию (касса). Тёмная — не в MVP; если понадобится, только переопределением семантического слоя через `[data-theme="dark"]`, без правок компонентов. |
| Контраст | WCAG 2.1 AA: текст 4.5:1, крупный текст и нетекстовые элементы (рамки полей, иконки, фокус) 3:1. |
| Клавиатура/сканер | Всё доступно с клавиатуры; сканер = HID-клавиатура (быстрый ввод + Enter). Фокус видим всегда (глобально в `base.css`). |
| Локализация | RU/TJ, `lang` на `<html>`; бюджет длины строк +40 %; шрифт с `cyrillic-ext` (ҳ ҷ ӣ қ ӯ ғ); строки не хардкодятся в компонентах. |
| Деньги | Integer в дирамах во всех слоях; форматирование в сомони — только на отображении через `libs/shared/util`. Никакого `/ 100` и `toFixed` в компонентах. |
| Даты | Через `libs/shared/util`, `dd.MM.yyyy`, 24 ч, `Asia/Dushanbe`; срок годности — date-only, без сдвига часового пояса. |
| Печать | Чек 58/80 мм: отдельный print-корень, моноширинная сетка по колонкам, только чёрный, `@page { margin: 0 }`. |

## Error Handling

| Обнаружено | Исправление |
|---|---|
| Hex/rgb/oklch в компоненте | Заменить на семантический или компонентный токен. Нет подходящего — добавить токен в `libs/ui` (semantic/components), не литерал. |
| Примитив в компоненте (`var(--ph-green-700)`) | Заменить на семантику (`--ph-color-primary`) — примитивы видят только файлы токенов. |
| Сырые `px`/`rem` | Взять значение из шкалы `--ph-space-*` / `--ph-size-*`. Значение между ступенями — сначала обсудить, нужен ли новый шаг шкалы. |
| Цель < 44 px | Увеличить `min-block-size`/`min-inline-size` до `--ph-size-touch-*`; расширять область касания паддингом, не `transform: scale`. |
| Статус только цветом | Добавить иконку (`aria-hidden`) + видимый текст статуса. |
| `outline: none` без замены | Удалить: фокус задаётся глобально в `base.css`. |
| `amount / 100`, `toFixed(2)`, `parseFloat` для денег | Использовать `formatMoney`/`parseMoneyToMinor` из `libs/shared/util`. |

## Machine Enforcement

Линтера дизайн-системы в проекте нет (stylelint с `declaration-strict-value` и подобные плагины —
новые зависимости, только через ADR); автоматически проверяется доступность — axe-гейт ADR-0009.
Токены и литералы проверяются поиском. Команды — из корня `pharmacy`:

```bash
SCOPE="apps libs/ui/src/lib"
EXCL=(--glob '!**/*.spec.*' --glob '!**/*.test.*' --glob '!apps/*-e2e/**' --glob '!libs/ui/src/styles/tokens/**')

# 1. Цветовые литералы (hex ловит и якоря вида "#add" — разбирать вручную)
rg -n "${EXCL[@]}" -e '#[0-9a-fA-F]{3,8}\b' -e '\b(rgba?|hsla?|oklch|oklab|lab|lch|color-mix)\(' $SCOPE
# 2. Сырые длины в стилях (0 допустим без единиц)
rg -n "${EXCL[@]}" --glob '*.css' -e '\b\d+(\.\d+)?(px|rem|em|pt|mm)\b' $SCOPE
# 3. Inline-стили и литеральный z-index
rg -n "${EXCL[@]}" -e 'style=\{\{' -e 'z-index:\s*\d' $SCOPE
# 4. Примитивы вне файлов токенов
rg -n "${EXCL[@]}" -e 'var\(--ph-(neutral|green|red|amber|blue)-\d+' $SCOPE
# 5. Сброс фокуса
rg -n "${EXCL[@]}" -e 'outline:\s*(none|0)' $SCOPE
# 6. Деньги во float
rg -n "${EXCL[@]}" -e '\b\w*(amount|price|sum|total)\w*\s*/\s*100\b' -e 'toFixed\(2\)' -e 'parseFloat\(' $SCOPE
```

Проверки Tailwind-классов (палитра по умолчанию, arbitrary values, модификаторы прозрачности,
`dark:`) — в скиле `tailwind-patterns` (§13).

## Scope and Exception Policy

| Включено | Исключено |
|---|---|
| `apps/web/src/**`, `apps/admin/src/**` (`.tsx`, `.ts`, `.module.css`, `.css`) | `libs/ui/src/styles/tokens/**` — здесь сырые значения и должны быть |
| `libs/ui/src/lib/**` — компоненты UI-кита | `*.spec.*`, `*.test.*`, `apps/*-e2e/**` |
| `libs/ui/src/styles/base.css` — проверяется ревью (служебные классы вроде visually-hidden используют `1px` законно) | `node_modules/`, `dist/`, `out/`, `.next/`, сгенерированный код |

Легитимные исключения (не нарушение): вычисляемая геометрия (смещения виртуализированного списка,
ширина колонки после ресайза пользователем) через `style` с CSS-переменной; `mm`/`pt` внутри print-токенов.

Если правило нужно нарушить намеренно:

1. Маркер рядом со строкой: `/* ignore-design: <причина> */` в CSS, `// ignore-design: <причина>` в TS,
   `{/* ignore-design: <причина> */}` в JSX.
2. Причина объясняет ПОЧЕМУ (не «так быстрее»).
3. Исключения ревьюятся как техдолг; периодически `rg -n 'ignore-design'` и чистка устаревших.
4. 5+ исключений в одном файле — сигнал, что шкалы/токены нужно расширить: вынести вопрос в MR.

## Verify

Перед сдачей UI-изменения:

1. Аудит-команды выше — без новых нарушений (или каждое помечено `ignore-design` с причиной).
2. Новые токены добавлены в правильный слой; семантика не ссылается на компонентные токены,
   компоненты — не на примитивы.
3. Контраст новых пар цветов проверен (инструмент с поддержкой OKLCH, например oklch.com + любой
   WCAG-калькулятор после конвертации в sRGB): текст ≥ 4.5:1, рамки/иконки/фокус ≥ 3:1.
4. Касса проверена на 1280×800 и при масштабе 125 %, сенсорные цели по шкале, сценарий проходится
   только с клавиатуры (и сканером — Enter после кода).
5. Строки проверены на TJ-локали (длина, глифы `Ғ ғ Қ қ Ҳ ҳ Ҷ ҷ Ӣ ӣ Ӯ ӯ` в обычном и жирном начертании).
6. Для чеков — предпросмотр печати Chrome на 58 и 80 мм.
7. Новый интерактивный компонент `libs/ui`: чек-лист ARIA APG в шапке файла, тест клавиатурного
   сценария и `jest-axe` без нарушений (ADR-0007 п. 7, ADR-0009).
8. `npx nx lint <proj>`, `npx nx test <proj>`, `npx nx build <proj>` (или `npx nx affected -t build test lint`) — зелёные.

## Related Skills

- `tailwind-patterns` — подключение этих токенов в Tailwind v4 `@theme` (ADR-0007)
- `react-dev` — структура React-кода, нейминг, тесты
- `web-performance-optimization` — размер CSS/шрифтов, производительность экранов кассы
