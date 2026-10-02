# UI Design Tokens — libs/ui (Pharmacy)

Источник истины — CSS custom properties в `libs/ui`. Префикс `--ph-` (pharmacy) обязателен: он
отделяет наши токены от переменных Tailwind `@theme` (ADR-0007) и делает аудит однозначным.

> Значения цветов ниже — **стартовые примеры** (взяты из открытой палитры Tailwind v4, MIT, как числа
> OKLCH). Финальную палитру утверждает дизайн; контраст каждой пары проверяется.

## 0. Файлы в libs/ui

```
libs/ui/src/
├── styles/
│   ├── tokens/
│   │   ├── primitives.css   # сырые значения: цвет (OKLCH), шкалы rem, длительности
│   │   ├── semantic.css     # смысловые роли; темы и плотность переопределяют ЭТОТ слой
│   │   ├── components.css   # токены компонентов и доменных статусов
│   │   └── print.css        # токены печати, mm/pt только здесь (создаётся вместе с ReceiptPrint)
│   ├── fonts.css            # self-hosted @font-face (без CDN)
│   ├── base.css             # шрифт body, :focus-visible, печать, служебные классы
│   ├── controls.css         # нативные контролы: base-select, dialog, popover
│   ├── tailwind-theme.css   # @theme / @theme inline — маппинг токенов в утилиты (ADR-0007)
│   └── index.css            # точка входа: fonts → tokens/* → base → controls (reset не нужен — preflight)
└── lib/                     # компоненты UI-кита по папкам kebab-case: button/Button.tsx, overlay/Dialog.tsx, cx.ts …
```

Подключение в приложении — один раз, в глобальных стилях слоя `app` (FSD, ADR-0017):
`apps/web/src/app/styles/global.css` импортирует Tailwind, `libs/ui/src/styles/index.css` (в
`layer(base)`) и `tailwind-theme.css`; его подключает `src/app/layouts/RootLayout.tsx`, а
маршрут `apps/web/app/layout.tsx` только реэкспортирует RootLayout. Полный файл — скил
`tailwind-patterns` §4; `apps/admin` устроен так же.

Компоненты используют токены через утилиты Tailwind, сгенерированные из `@theme inline`
(`bg-primary`, `p-4`), или ссылкой `utility-(--ph-…)`; `var(--ph-…)` в CSS — только в
`ReceiptPrint` и `PosLayout` (CSS Modules) и в файлах `libs/ui/src/styles`.

## 1. Цвет (3 уровня)

### Примитивы — `primitives.css`

```css
:root {
  /* Neutral */
  --ph-neutral-0: oklch(1 0 0);
  --ph-neutral-50: oklch(0.985 0.002 247.8);
  --ph-neutral-100: oklch(0.967 0.003 264.5);
  --ph-neutral-200: oklch(0.928 0.006 264.5);
  --ph-neutral-300: oklch(0.872 0.01 258.3);
  --ph-neutral-500: oklch(0.551 0.027 264.4);
  --ph-neutral-600: oklch(0.446 0.03 256.8);
  --ph-neutral-700: oklch(0.373 0.034 259.7);
  --ph-neutral-900: oklch(0.21 0.034 264.7);
  --ph-neutral-1000: oklch(0 0 0);
  /* Hues: green = brand/success, red = danger, amber = warning, blue = info/focus */
  --ph-green-50: oklch(0.982 0.018 155.8);
  --ph-green-600: oklch(0.627 0.194 149.2);
  --ph-green-700: oklch(0.527 0.154 150.1);
  --ph-green-800: oklch(0.448 0.119 151.3);
  --ph-red-50: oklch(0.971 0.013 17.4);
  --ph-red-600: oklch(0.577 0.245 27.3);
  --ph-red-700: oklch(0.505 0.213 27.5);
  --ph-red-800: oklch(0.444 0.177 26.9);
  --ph-amber-50: oklch(0.987 0.022 95.3);
  --ph-amber-600: oklch(0.666 0.179 58.3);
  --ph-amber-800: oklch(0.473 0.137 46.2);
  --ph-blue-50: oklch(0.97 0.014 254.6);
  --ph-blue-600: oklch(0.546 0.245 262.9);
  --ph-blue-700: oklch(0.488 0.243 264.4);
  /* Scrim — единственная полупрозрачность палитры */
  --ph-scrim-50: oklch(0.21 0.034 264.7 / 0.5);
}
```

OKLCH: перцептивно равномерна — ступени светлоты предсказуемы, hover-состояния получаются сдвигом
L. Часть значений палитры Tailwind v4 выходит за sRGB (рассчитана на P3); мониторы касс — sRGB,
поэтому финальные значения держать внутри sRGB (проверка на oklch.com) и мерить контраст по
отображаемому цвету.

### Семантика — `semantic.css`

```css
:root,
[data-theme='light'] {
  color-scheme: light;
  --ph-color-bg: var(--ph-neutral-50);              /* фон страницы */
  --ph-color-surface: var(--ph-neutral-0);          /* карточки, панели, таблицы */
  --ph-color-surface-sunken: var(--ph-neutral-100); /* шапки таблиц, зебра, поля */
  --ph-color-fg: var(--ph-neutral-900);             /* основной текст */
  --ph-color-fg-muted: var(--ph-neutral-600);       /* вторичный текст, ≥ 4.5:1 на surface */
  --ph-color-border: var(--ph-neutral-200);         /* декоративные разделители */
  --ph-color-border-control: var(--ph-neutral-500); /* рамки полей/чекбоксов: ≥ 3:1 (WCAG 1.4.11) */
  --ph-color-primary: var(--ph-green-700);
  --ph-color-primary-hover: var(--ph-green-800);
  --ph-color-on-primary: var(--ph-neutral-0);
  --ph-color-focus-ring: var(--ph-blue-600);
  --ph-color-overlay: var(--ph-scrim-50);       /* подложка модалок */
  --ph-color-disabled: var(--ph-neutral-200);
  --ph-color-on-disabled: var(--ph-neutral-600);

  /* Статусы: solid (текст/иконка/кнопка), subtle (фон плашки), border */
  --ph-color-success: var(--ph-green-700);
  --ph-color-success-subtle: var(--ph-green-50);
  --ph-color-success-border: var(--ph-green-600);
  --ph-color-warning: var(--ph-amber-800);
  --ph-color-warning-subtle: var(--ph-amber-50);
  --ph-color-warning-border: var(--ph-amber-600);
  --ph-color-danger: var(--ph-red-700);
  --ph-color-danger-hover: var(--ph-red-800);
  --ph-color-on-danger: var(--ph-neutral-0);
  --ph-color-danger-subtle: var(--ph-red-50);
  --ph-color-danger-border: var(--ph-red-600);
  --ph-color-info: var(--ph-blue-700);
  --ph-color-info-subtle: var(--ph-blue-50);
  --ph-color-info-border: var(--ph-blue-600);
}
```

Правила:
- Компоненты и экраны используют только семантику или компонентные токены. Примитивы — только в
  `semantic.css`/`components.css`.
- Полупрозрачные цвета, `color-mix()`, `opacity` на тексте в компонентах запрещены: контраст таких
  цветов никто не проверял. Нужен новый оттенок — новый семантический токен.
- Пары «текст/фон» проектируются вместе: `--ph-color-X` на `--ph-color-X-subtle` и на `surface` —
  ≥ 4.5:1; `--ph-color-on-X` на `--ph-color-X` — ≥ 4.5:1.

### Компонентные — `components.css`

```css
:root {
  --ph-button-height: var(--ph-size-touch-min);
  --ph-button-height-pos: var(--ph-size-touch-pos);
  --ph-button-height-primary: var(--ph-size-touch-primary);
  --ph-button-padding-x: var(--ph-space-4);
  --ph-button-radius: var(--ph-radius-md);
  --ph-button-bg-primary: var(--ph-color-primary);
  --ph-button-bg-primary-hover: var(--ph-color-primary-hover);
  --ph-button-fg-primary: var(--ph-color-on-primary);

  --ph-input-height: var(--ph-size-touch-min);
  --ph-input-border: var(--ph-color-border-control);
  --ph-input-border-focus: var(--ph-color-focus-ring);
  --ph-input-border-invalid: var(--ph-color-danger);

  --ph-table-row-height: var(--ph-size-row-dense);
  --ph-table-cell-padding-x: var(--ph-space-3);
  --ph-table-header-bg: var(--ph-color-surface-sunken);
  --ph-table-row-bg-alt: var(--ph-color-surface-sunken);

  /* Доменные статусы партии (batch) — всегда вместе с иконкой и текстом */
  --ph-batch-expiring-fg: var(--ph-color-warning);
  --ph-batch-expiring-bg: var(--ph-color-warning-subtle);
  --ph-batch-expiring-border: var(--ph-color-warning-border);
  --ph-batch-expired-fg: var(--ph-color-danger);
  --ph-batch-expired-bg: var(--ph-color-danger-subtle);
  --ph-batch-expired-border: var(--ph-color-danger-border);

  /* Экран кассы */
  --ph-pos-side-width: 26rem;        /* правая панель: итог, оплата, клавиатура */
  --ph-pos-rows: auto minmax(0, 1fr) auto;                   /* шапка | чек + панель | действия */
  --ph-pos-columns: minmax(0, 1fr) var(--ph-pos-side-width);
  --ph-pos-total-font-size: var(--ph-font-size-3xl);
}
```

Нейминг: `--ph-{component}-{property}-{variant?}-{state?}`. Порог «истекает срок» (сколько дней
до окончания) — бизнес-настройка, а не токен; UI получает уже вычисленный статус.

## 2. Отступы — одна шкала, база 4 px

```css
:root {
  --ph-space-0: 0;
  --ph-space-1: 0.25rem;  /* 4 */
  --ph-space-2: 0.5rem;   /* 8  — минимальный зазор между сенсорными целями */
  --ph-space-3: 0.75rem;  /* 12 */
  --ph-space-4: 1rem;     /* 16 */
  --ph-space-5: 1.25rem;  /* 20 */
  --ph-space-6: 1.5rem;   /* 24 */
  --ph-space-8: 2rem;     /* 32 */
  --ph-space-10: 2.5rem;  /* 40 */
  --ph-space-12: 3rem;    /* 48 */
  --ph-space-16: 4rem;    /* 64 */
}
```

Никаких параллельных `--ph-spacing-sm/md/lg` (Iron Law 2). Отступ «между ступенями» — повод
обсудить шкалу, а не писать `13px`. Для направленных отступов — логические свойства
(`padding-inline`, `margin-block`).

## 3. Размеры

```css
:root {
  --ph-size-touch-min: 2.75rem;     /* 44 — минимум любой интерактивной цели в apps/web */
  --ph-size-touch-pos: 3rem;        /* 48 — кнопки, строки выбора, цифры клавиатуры кассы */
  --ph-size-touch-primary: 4rem;    /* 64 — «Оплатить», «Отложить чек», подтверждения */
  --ph-size-row-dense: 2.75rem;     /* 44 — плотные таблицы склада/отчётов на сенсорном экране */
  --ph-size-row-compact: 2.25rem;   /* 36 — только apps/admin с data-density="compact" */
  --ph-size-icon-sm: 1rem;
  --ph-size-icon-md: 1.5rem;
  --ph-size-icon-lg: 2rem;
}
```

## 4. Типографика

```css
:root {
  /* Семейства: --ph-font-face-* выставляет next/font/local в корневом layout приложения
     (self-hosted, файл с subset cyrillic-ext); дальше — системный fallback */
  --ph-font-sans: var(--ph-font-face-sans, 'Segoe UI', system-ui, sans-serif);
  --ph-font-mono: var(--ph-font-face-mono, Consolas, 'Courier New', monospace);

  --ph-font-size-xs: 0.75rem;   --ph-line-height-xs: 1rem;      /* подписи, не для основного текста кассы */
  --ph-font-size-sm: 0.875rem;  --ph-line-height-sm: 1.25rem;   /* плотные таблицы */
  --ph-font-size-md: 1rem;      --ph-line-height-md: 1.5rem;    /* основной текст */
  --ph-font-size-lg: 1.125rem;  --ph-line-height-lg: 1.75rem;   /* кнопки кассы, строки чека */
  --ph-font-size-xl: 1.25rem;   --ph-line-height-xl: 1.75rem;   /* заголовки панелей */
  --ph-font-size-2xl: 1.5rem;   --ph-line-height-2xl: 2rem;     /* заголовок экрана, сумма строки */
  --ph-font-size-3xl: 2rem;     --ph-line-height-3xl: 2.5rem;   /* итог к оплате, сдача */

  --ph-font-weight-normal: 400;
  --ph-font-weight-medium: 500;
  --ph-font-weight-semibold: 600;
  --ph-font-weight-bold: 700;
}
```

- Размеры только в `rem` (масштабирование браузера должно работать, WCAG 1.4.4).
- Суммы, количества, штрих-коды — `font-variant-numeric: tabular-nums` (класс `.ph-numeric` в
  `base.css`); выбранный шрифт должен поддерживать `tnum`.
- Шрифт выбирается с лицензией OFL/аналогичной и полным `cyrillic-ext` (кандидаты: Noto Sans /
  Noto Sans Mono, Inter — проверить глифы ҳ ҷ ӣ қ ӯ ғ во всех начертаниях). Сейчас подключён
  TT Norms Pro (коммерческий; глифы TJ и `tnum` проверены, лицензию подтвердить до релиза —
  `libs/ui/src/styles/fonts.css`); смена шрифта — только в `fonts.css` и `--ph-font-sans`.
  Никаких CDN (офлайн-точки).

## 5. Радиусы, рамки, тени

```css
:root {
  --ph-radius-none: 0;
  --ph-radius-sm: 0.25rem;
  --ph-radius-md: 0.5rem;
  --ph-radius-lg: 0.75rem;
  --ph-radius-full: 9999px;
  --ph-border-width-1: 1px;
  --ph-border-width-2: 2px;
  --ph-focus-ring-width: 3px;
  --ph-focus-ring-offset: 2px;
  --ph-shadow-sm: 0 1px 2px oklch(0 0 0 / 0.06);
  --ph-shadow-md: 0 4px 8px oklch(0 0 0 / 0.1);
  --ph-shadow-lg: 0 12px 24px oklch(0 0 0 / 0.14);  /* модалки, выпадающие списки */
}
```

Тени — только для слоёв над контентом (dropdown, dialog, toast). Разделение панелей кассы —
рамкой `--ph-color-border` или фоном, не тенью.

## 6. Z-index и motion

```css
:root {
  --ph-z-base: 0;
  --ph-z-sticky: 100;      /* липкие шапки таблиц, панель действий кассы */
  --ph-z-dropdown: 1000;
  --ph-z-overlay: 1040;
  --ph-z-modal: 1050;
  --ph-z-toast: 1060;
  --ph-z-tooltip: 1070;

  --ph-duration-fast: 120ms;    /* hover, нажатие */
  --ph-duration-normal: 200ms;  /* раскрытие, появление плашки */
  --ph-duration-slow: 300ms;    /* модалки */
  --ph-ease-standard: cubic-bezier(0.2, 0, 0, 1);
  --ph-ease-out: cubic-bezier(0, 0, 0.2, 1);
}

@media (prefers-reduced-motion: reduce) {
  :root {
    --ph-duration-fast: 0ms;
    --ph-duration-normal: 0ms;
    --ph-duration-slow: 0ms;
  }
}
```

На кассе анимация не должна задерживать операцию: никаких переходов длиннее `--ph-duration-slow`,
никаких анимаций на пути «скан → строка чека». Нативный `<dialog>` рисуется в top layer — z-index
для него не нужен.

## 7. Экраны и container queries

Custom properties нельзя использовать в `@media`/`@container`, поэтому точки перелома — это
таблица-конвенция (и литералы `--breakpoint-*` / `--container-*` в `@theme`, ADR-0007):

| Имя | Min width | Назначение |
|---|---|---|
| (база) | — | 1024–1279 CSS px: POS 10″ при масштабе Windows 125 % — всё работает, панели уже |
| `lg` | 80rem (1280) | Целевой экран кассы 1280×800 |
| `xl` | 100rem (1600) | Широкие мониторы склада/кабинета |
| `2xl` | 120rem (1920) | Full HD |

Компоненты, которые живут и в узкой панели кассы, и на всю ширину склада (карточка товара,
список партий) — адаптируются через `@container`, а не через viewport.

## 8. Темы и плотность

```css
/* Тёмная тема — НЕ в MVP. Если понадобится: переопределяется только семантический слой,
   с повторной проверкой контраста всех пар. Компоненты не меняются. */
[data-theme='dark'] {
  color-scheme: dark;
  --ph-color-bg: var(--ph-neutral-900);
  --ph-color-surface: var(--ph-neutral-700);
  --ph-color-fg: var(--ph-neutral-50);
  /* … все остальные семантические токены … */
}

/* Плотность — только apps/admin (мышь). Предложение, согласовать с дизайном. */
[data-density='compact'] {
  --ph-table-row-height: var(--ph-size-row-compact);
  --ph-button-height: var(--ph-size-row-compact);
  --ph-input-height: var(--ph-size-row-compact);
}
```

Тема/плотность ставятся атрибутом на `<html>` (или на поддерево). Состояние темы, если она
появится, — пользовательская настройка; в `localStorage` допустимо, без ПДн.

## 9. base.css (фрагмент)

```css
html {
  font-family: var(--ph-font-sans);
  font-size: 100%;               /* 1rem = 16px, масштаб пользователя сохраняется */
  color: var(--ph-color-fg);
  background: var(--ph-color-bg);
}

:focus-visible {
  outline: var(--ph-focus-ring-width) solid var(--ph-color-focus-ring);
  outline-offset: var(--ph-focus-ring-offset);
}

.ph-numeric {
  font-variant-numeric: tabular-nums;
}

.ph-visually-hidden {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
```

Фокус — через `outline`, а не `box-shadow`: outline сохраняется в режиме высокой контрастности
Windows (`forced-colors`).

## 10. Пример компонента

Компоненты `libs/ui` пишутся на утилитах Tailwind из токенов: образец — `libs/ui/src/lib/button/Button.tsx`
(разбор — скил `tailwind-patterns` §5). Варианты — карты `Record<Variant, string>`, склейка —
`cx()` из `libs/ui/src/lib/cx.ts`; `clsx`/`classnames`/`tailwind-merge`/CVA не используются
(ADR-0007). Внешний `className` компонента — только раскладка.

CSS Modules с `var(--ph-…)` — только `ReceiptPrint` (`reference/ui-print-receipts.md`) и
`PosLayout` (сетка экрана кассы на компонентных токенах `--ph-pos-*`).
