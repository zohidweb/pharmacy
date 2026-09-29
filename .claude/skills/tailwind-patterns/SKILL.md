---
name: tailwind-patterns
description: "Tailwind CSS v4 patterns for Pharmacy Next.js (React, TypeScript) apps in the Nx monorepo — ONLY after an ADR selects Tailwind as the CSS approach for libs/ui. CSS-first @theme mapped from libs/ui design tokens (--ph-* CSS custom properties), @source scanning of apps and libs, className composition, container queries, OKLCH tokens, token-driven theming (no dark: utilities), POS / касса patterns (large touch targets, cashier screen grid), dense warehouse/report tables, ban on arbitrary values, short v3→v4 reference. Use when an ADR on Tailwind exists and you write or review utility classes in apps/web, apps/admin or libs/ui, or when preparing that ADR (Tailwind, утилитарные классы, @theme)."
risk: low
source: "adapted from kumaran-is/claude-code-onboarding (MIT), develop@a7f2fc5"
date_added: "2026-02-27"
updated: "2026-09-29"
last-reviewed: "2026-09-29"
allowed-tools:
  - Read
  - Grep
  - Glob
  - Edit
  - Write
metadata:
  triggers: Tailwind, Tailwind v4, @theme, utility classes, className, container queries, @source, Nx Tailwind, Next.js Tailwind, POS layout, касса, утилитарные классы
  related-skills: ui-standards-tokens, react-dev, web-performance-optimization
  domain: frontend
  role: specialist
  scope: implementation
  output-format: code
---

## Pharmacy: контекст и ограничения

Оригинал был написан под другой фронтенд-стек и готовую UI-библиотеку. Переписан под Next.js
(React, TypeScript) в Nx-монорепо `pharmacy-app`; маркетинговые Bento-раскладки удалены.

- **Tailwind CSS не зафиксирован в `docs/architecture/stack.md`. Tailwind CSS применяется только
  после ADR о выборе CSS-подхода для libs/ui (через /03-adr). До ADR — токены как CSS custom
  properties + CSS Modules** (скил `ui-standards-tokens`). Этот скил описывает связку на случай
  положительного ADR и помогает подготовить сам ADR (§1).
- Технология вне радара → tech-radar/EXCEPTIONS.md, не молча (корневой CLAUDE.md, правило 2).
- **Любые UI-библиотеки и плагины** (shadcn/ui, Radix, Headless UI, Flowbite, MUI…) —
  тоже только через ADR. Хелперы `clsx`/`tailwind-merge` (`cn`) и `class-variance-authority`
  (CVA) — **зависимости на согласование**; до согласования — примеры без них (§5).
- Источник истины дизайна — токены `--ph-*` в `libs/ui` (скил `ui-standards-tokens`). Tailwind
  только **отображает** их в утилиты через `@theme inline`; своих значений в `@theme` не заводим
  (кроме breakpoints/containers — их нельзя задать через `var()`).
- Стек фронта (CLAUDE.md монорепо, источник `docs/architecture/generated/CLAUDE.pharmacy-app.md`):
  Next.js в режиме `output: 'export'` (без SSR), Chrome/Edge последние 2 версии, сенсорные экраны от
  10″ (1280×800+), тесты — Jest. Tailwind работает только на этапе сборки — рантайма и CDN нет
  (Play CDN запрещён: офлайн-точки, закрытый список внешних вызовов).
- Структура React-кода и нейминг — скил `react-dev`.

---

**Triggers:** ADR на Tailwind принят (подключение в Nx/Next.js, `className` в apps/web, apps/admin,
libs/ui); подготовка ADR о CSS-подходе; приведение примера Tailwind v3 к v4 и нашим токенам.

## Iron Law

**NO TAILWIND WITHOUT AN ACCEPTED ADR. WITH THE ADR — NO UTILITY CLASS BEFORE READING `libs/ui/src/styles/tailwind-theme.css`: only utilities generated from `--ph-*` tokens exist; arbitrary values (`p-[13px]`, `bg-[#fff]`) are forbidden.**

# Tailwind CSS v4 Patterns — Pharmacy (Next.js + Nx)

## 1. Что должен решить ADR (чек-лист для /03-adr)

| Вопрос | Предлагаемый ответ (для обсуждения) |
|---|---|
| Подход | Tailwind v4 для раскладки и простых компонентов + CSS Modules для сложных (печать чека, POS-сетка) — или «только CSS Modules» (альтернатива, отказ от Tailwind) |
| Версия | Tailwind CSS 4.x, `@tailwindcss/postcss`; фиксированная версия в корневом `package.json` (single-version policy Nx) |
| Токены | Источник — `--ph-*` в `libs/ui`; `@theme` только маппит (§3); дефолтная тема сброшена |
| Хелперы | `clsx` + `tailwind-merge` (`cn`) — да/нет; CVA — да/нет (лицензии MIT, проверить) |
| UI-библиотеки | Отдельное решение (shadcn/ui/Radix и т.п. — не входят автоматически) |
| Контроль | Как ловим arbitrary values и дефолтную палитру: grep в Verify (§13) до появления линтера; `eslint-plugin-tailwindcss` / аналог — отдельное согласование (поддержка v4 проверяется) |
| Preflight | Tailwind preflight заменяет reset из `libs/ui/base.css`; токены и `:focus-visible` остаются |

## 2. Архитектура

```
libs/ui/src/styles/tokens/*.css   --ph-color-primary, --ph-space-4 …   (источник истины)
          ↓  @theme inline — только ссылки var(--ph-*)
libs/ui/src/styles/tailwind-theme.css   --color-primary: var(--ph-color-primary) …
          ↓  генерирует утилиты
className="bg-primary p-4 min-h-touch-pos"   →   background-color: var(--ph-color-primary)
```

Почему `@theme inline`: утилита получает `var(--ph-…)` напрямую, поэтому переопределение
семантики на поддереве (`[data-theme]`, `[data-density]`) сразу меняет вид. Без `inline` значение
разрешилось бы один раз на `:root` и темы на поддереве не работали бы.

Почему префикс `--ph-`: имена `@theme` (`--color-primary`) и наши токены не должны совпадать —
иначе `--color-primary: var(--color-primary)` стал бы циклической ссылкой.

## 3. Маппинг токенов в `@theme`

Полный файл `libs/ui/src/styles/tailwind-theme.css` и таблица «токен → утилиты» —
**`reference/tailwind-theme-mapping.md`** (прочитать перед правкой темы). Суть:

```css
@theme {
  --*: initial;            /* drop the default theme: no bg-blue-500, no p-13, no text-7xl */
  --breakpoint-lg: 80rem;  /* literals only here: media/container queries cannot use var() */
  --container-md: 28rem;
  /* … */
}

@theme inline {
  --color-primary: var(--ph-color-primary);           /* → bg-primary, text-primary */
  --color-on-primary: var(--ph-color-on-primary);
  --spacing-4: var(--ph-space-4);                     /* → p-4, gap-4 (no --spacing base) */
  --spacing-touch-pos: var(--ph-size-touch-pos);      /* → min-h-touch-pos, size-touch-pos */
  --spacing-row-dense: var(--ph-size-row-dense);      /* → h-row-dense */
  --text-lg: var(--ph-font-size-lg);
  --text-lg--line-height: var(--ph-line-height-lg);
  --radius-md: var(--ph-radius-md);
  --default-transition-duration: var(--ph-duration-fast);
  /* … the full list is in the reference */
}
```

После `--*: initial` исчезают и анимации по умолчанию (`animate-spin`): нужные — объявить явно
(`--animate-spin` + `@keyframes`). У z-index и длительностей нет namespace темы — используются
ссылки `z-(--ph-z-modal)`, `duration-(--ph-duration-normal)`. Новый токен сначала появляется в
`libs/ui` (ui-standards-tokens), потом строкой маппинга — не наоборот.

## 4. Подключение в Nx + Next.js

```js
// apps/web/postcss.config.mjs (and the same in apps/admin)
export default { plugins: { '@tailwindcss/postcss': {} } };
```

```css
/* apps/web/src/app/globals.css — imported once in the root layout.
   Paths are relative to this file: check against the real tree. */
@import 'tailwindcss' source(none);               /* no implicit scanning: explicit @source below */
@import '../../../../libs/ui/src/styles/index.css' layer(base); /* --ph-* tokens + base (focus, print) */
@import '../../../../libs/ui/src/styles/tailwind-theme.css';

@source '../';                                    /* apps/web/src */
@source '../../../../libs/ui/src/lib';            /* UI-kit components with className */
```

- `source(none)` + явные `@source`: автоопределение в монорепо зависит от рабочего каталога
  сборки (Nx/Next) и может не увидеть `libs/ui`. Явный список детерминирован.
- `apps/admin` — такой же вход со своим `@source '../'`; libs/ui подключается одинаково.
- Токены импортируются в `layer(base)`, утилиты Tailwind — в `utilities`, поэтому утилиты
  побеждают базовые стили. **CSS Modules — вне слоёв и побеждают любые утилиты** независимо от
  специфичности: на одном элементе не смешивать Tailwind и правила CSS Modules для одного свойства.
- Reset при Tailwind не нужен (его заменяет preflight): `libs/ui/src/styles/reset.css` подключается
  только в варианте без Tailwind, `index.css` его не импортирует.
- Jest: CSS не компилируется (моки CSS из конфигурации Nx), Tailwind в тестах не нужен.
- `output: 'export'`: CSS извлекается при сборке, в `out/` — обычные файлы; ничего серверного.

## 5. Классы в компонентах

- Только полные статичные имена классов в исходниках — сканер Tailwind ищет строки, а не выполняет
  код. `bg-${tone}` не сработает.
- Варианты — словарём полных строк (`Record<Variant, string>`), без пересекающихся свойств между
  вариантами (тогда `tailwind-merge` не нужен).

```tsx
// libs/ui/src/lib/Button/Button.tsx — without clsx/CVA (until approved)
import type { ButtonHTMLAttributes } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'danger';
type ButtonSize = 'default' | 'pos' | 'primaryAction';

const base =
  'inline-flex items-center justify-center gap-2 rounded-md border border-transparent px-4 ' +
  'font-semibold transition-colors disabled:bg-disabled disabled:text-on-disabled';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-on-primary hover:bg-primary-hover',
  secondary: 'bg-surface text-fg border-control hover:bg-surface-sunken',
  danger: 'bg-danger text-on-danger hover:bg-danger-hover',
};

const sizes: Record<ButtonSize, string> = {
  default: 'min-h-touch min-w-touch text-md',
  pos: 'min-h-touch-pos min-w-touch-pos text-lg',
  primaryAction: 'min-h-touch-primary text-xl',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({ variant = 'primary', size = 'default', className, type = 'button', ...rest }: ButtonProps) {
  const classes = [base, variants[variant], sizes[size], className].filter(Boolean).join(' ');
  return <button type={type} className={classes} {...rest} />;
}
```

Если согласованы `clsx` + `tailwind-merge`: `cn(...inputs) = twMerge(clsx(inputs))` в
`libs/ui/src/lib/cn.ts`; `tailwind-merge` нужно настроить под нашу тему (`extendTailwindMerge`:
кастомные `text-md`, `min-h-touch-pos`, цвета `text-fg`) — иначе он может принять `text-fg` и
`text-lg` за конфликт или не распознать их. Если согласован CVA — словари выше переносятся в
`cva(base, { variants })` без изменения самих классов.

Фокус: глобальный `:focus-visible` из `libs/ui/base.css` — в компонентах `focus:`/`outline-*` не
переопределять, `outline-hidden` без замены запрещён.

## 6. Запрет arbitrary values

| Запрещено | Вместо |
|---|---|
| `p-[13px]`, `w-[372px]`, `text-[15px]` | Шкала (`p-3`, `w-pos-side`, `text-md`); нет шага — новый токен в libs/ui |
| `bg-[#16a34a]`, `text-[rgb(…)]`, `bg-primary/50` | Семантический цвет; прозрачность — отдельный токен (`--ph-color-overlay`) |
| `grid-cols-[1fr_26rem]` | Токен + ссылка на него: `grid-cols-(--ph-pos-columns)` или CSS Module |
| `z-[999]`, `z-50` | `z-(--ph-z-modal)` |
| `!` / `!important`, inline `style` | Исправить порядок/специфичность; геометрия — через CSS-переменную |

Единственная допустимая «произвольная» форма — ссылка на токен: `utility-(--ph-…)` (семантический
или компонентный токен, не примитив). Остальное — только с `ignore-design` и причиной (политика
исключений — в `ui-standards-tokens`).

## 7. Экран кассы (POS)

```tsx
// apps/web/src/features/pos/PosScreen.tsx — layout only; data/logic live in the feature
<div className="grid h-dvh grid-rows-(--ph-pos-rows) bg-bg text-fg">
  <header className="flex items-center gap-4 border-b border-border bg-surface px-4 py-2">
    {/* store, shift, cashier, connection status: icon + text ("Нет связи — в буфере: 3") */}
  </header>

  <main className="grid min-h-0 grid-cols-(--ph-pos-columns) gap-4 p-4">
    <section className="flex min-h-0 flex-col gap-3" aria-label={t('pos.cart')}>
      {/* scan/search input (default focus) + receipt lines table, scrolls inside */}
    </section>
    <aside className="flex flex-col gap-3 rounded-lg bg-surface p-4" aria-label={t('pos.payment')}>
      {/* total (text-3xl font-bold tabular-nums), payments, on-screen keypad */}
    </aside>
  </main>

  <footer className="sticky bottom-0 z-(--ph-z-sticky) flex gap-2 border-t border-border bg-surface p-2">
    {/* action bar: Button size="pos"; primary actions size="primaryAction"; <kbd> hotkey hints */}
  </footer>
</div>
```

`--ph-pos-rows` (`auto minmax(0, 1fr) auto`) и `--ph-pos-columns` (`minmax(0, 1fr)
var(--ph-pos-side-width)`) — компонентные токены libs/ui; шаблоны сетки не пишутся в `[…]`.
Если раскладка разрастается — вынести её в CSS Module компонента `PosLayout`.

Правила кассы: цели ≥ `touch-pos` (48), главные действия `touch-primary` (64), зазор ≥ `gap-2`;
экранная цифровая клавиатура — `grid grid-cols-3 gap-2` из `Button size="pos"`; ничего по hover;
`min-h-0` у скролл-областей grid/flex, иначе список строк чека растягивает экран.

## 8. Плотные таблицы склада и отчётов

```tsx
<table className="w-full border-collapse text-sm tabular-nums">
  <caption className="sr-only">{t('stock.tableCaption')}</caption>
  <thead className="sticky top-0 z-(--ph-z-sticky) bg-surface-sunken">
    <tr>
      <th scope="col" className="h-row-dense px-3 text-left font-semibold">{t('stock.product')}</th>
      <th scope="col" className="h-row-dense px-3 text-right font-semibold">{t('stock.qty')}</th>
    </tr>
  </thead>
  <tbody>
    <tr className="border-b border-border even:bg-surface-sunken">
      <td className="h-row-dense px-3 wrap-anywhere line-clamp-2">{/* name; full name in row details */}</td>
      <td className="h-row-dense px-3 text-right">{/* formatted in libs/shared/util */}</td>
    </tr>
  </tbody>
</table>
```

- Числа, суммы, даты — `text-right tabular-nums`; валюта — в заголовке колонки.
- Строка на сенсорном экране — `h-row-dense` (44); в `apps/admin` с `data-density="compact"` высота
  меняется через токен, классы те же.
- Статус партии — компонент `BatchStatusBadge` (иконка + текст), не цвет строки.
- Большие объёмы — пагинация API (limit/offset); виртуализация — только после ADR (скил
  `web-performance-optimization`).
- `sr-only`, `wrap-anywhere` (v4.1+), `line-clamp-2` — статичные утилиты, сброс темы их не трогает;
  если утилиты нет в выбранной версии — класс из `libs/ui/base.css` (`ph-visually-hidden`).

## 9. Container queries

Для компонентов, которые живут и в узкой панели кассы, и на всю ширину склада (карточка товара,
список партий, аналоги по МНН):

```tsx
<div className="@container">
  <article className="grid gap-3 @md:grid-cols-2 @xl:grid-cols-3">{/* … */}</article>
</div>
```

Viewport-префиксы (`lg:`, `xl:`) — только для раскладки страницы; компоненты libs/ui — через
`@container` (размеры — `--container-*` из §3).

## 10. Тема, OKLCH, motion, печать

- **Тема — через токены**, не через `dark:`: `[data-theme]` переопределяет семантику в libs/ui,
  утилиты не меняются. Касса — светлая по умолчанию; тёмная не в MVP. Если когда-нибудь нужен
  точечный вариант: `@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));`.
- **OKLCH** — формат примитивов в libs/ui; в классах цветов-литералов нет вовсе. Модификаторы
  прозрачности (`/50`) дают непроверенный контраст — запрещены.
- **Motion**: `transition-colors` берёт длительность из `--ph-duration-fast`, а она обнуляется при
  `prefers-reduced-motion`; `motion-reduce:` нужен только для нестандартных анимаций. На пути
  «скан → строка чека» анимаций нет. `hover:scale-*` на кассе не использовать.
- **Печать**: `print:hidden` — чтобы скрыть элементы экрана; вёрстка чека 58/80 мм — CSS в libs/ui
  (ui-standards-tokens, `reference/ui-print-receipts.md`).

## 11. v3 → v4: коротко (при копировании старых примеров)

| v3 | v4 |
|---|---|
| `tailwind.config.js`, `theme.extend` | `@theme` в CSS (у нас — `@theme inline` из токенов) |
| `@tailwind base; @tailwind components; @tailwind utilities;` | `@import 'tailwindcss';` |
| `content: [...]` | автоопределение или `@source` (у нас — `source(none)` + явные `@source`) |
| PostCSS-плагин `tailwindcss` | `@tailwindcss/postcss` |
| `bg-opacity-50` | `bg-x/50` (у нас запрещено) |
| `shadow-sm` / `shadow`, `rounded-sm` / `rounded` | переименованы в `shadow-xs` / `shadow-sm`, `rounded-xs` / `rounded-sm` (у нас — только свои имена) |
| `outline-none` | `outline-hidden` |
| `ring` = 3px, border по умолчанию gray-200 | `ring` = 1px, border по умолчанию `currentColor` |
| `!bg-x` | `bg-x!` (у нас `!important` запрещён) |
| `bg-[--var]` | `bg-(--var)` |

Требования v4 к браузерам (Chrome 111+) закрываются нашим «Chrome/Edge последние 2 версии».

## 12. Anti-Patterns

| Don't | Do |
|---|---|
| Tailwind без ADR | CSS Modules + токены `--ph-*` |
| Значения в `@theme` литералами (кроме breakpoints/containers) | `var(--ph-…)` из libs/ui |
| Дефолтная палитра (`bg-blue-500`, `text-gray-700`) | Семантика (`bg-primary`, `text-fg-muted`) |
| Arbitrary values | Шкала или `utility-(--ph-…)` |
| Динамические имена классов | Словарь полных строк |
| `@apply` для «компонентов» | React-компонент в libs/ui |
| Tailwind и CSS Module на одном свойстве одного элемента | Одно средство на свойство |
| `dark:` в компонентах | Темы через токены |
| Длинные повторяющиеся списки классов в apps/* | Компонент в libs/ui |
| shadcn/Flowbite и т.п. «чтобы быстрее» | ADR на UI-библиотеку |

## 13. Verify

Перед сдачей изменений с Tailwind (из корня `pharmacy-app`):

1. ADR на Tailwind существует и принят; новые зависимости (`cn`, CVA) — согласованы.
2. Нет `tailwind.config.*` (v4 — только CSS); в `@theme inline` только `var(--ph-…)`.
3. Arbitrary values и дефолтная палитра:
   ```bash
   rg -n --glob '*.tsx' -e '\b[a-z:-]+-\[[^\]]+\]' apps libs/ui/src/lib | rg -v 'ignore-design'   # arbitrary values
   rg -n --glob '*.tsx' -e '\b(bg|text|border|ring|outline|fill|stroke|from|to|via)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b' apps libs/ui/src/lib
   rg -n --glob '*.tsx' -e '\b[a-z-]+/\d{1,3}\b' -e '\bdark:' apps libs/ui/src/lib   # opacity modifiers, dark:
   ```
4. Аудит токенов из `ui-standards-tokens` (hex/rgb/px вне токенов) — чистый.
5. Классы из `libs/ui` видны в сборке: `npx nx build web` и `npx nx build admin`, визуальная
   проверка экрана кассы на 1280×800 (и масштаб 125 %).
6. `npx nx affected -t build test lint` — зелёный.

## Related Skills

- `ui-standards-tokens` — система токенов `--ph-*`, доступность, локализация, печать чеков (источник истины)
- `react-dev` — структура и конвенции React-кода
- `web-performance-optimization` — размер CSS, производительность экранов кассы

Docs: [Tailwind CSS v4](https://tailwindcss.com/docs) (theme variables, `@source`, `@theme inline`) ·
[Container Queries (MDN)](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_containment/Container_queries) · [OKLCH](https://oklch.com/)
