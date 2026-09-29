# Маппинг токенов libs/ui в Tailwind v4 `@theme` (Pharmacy)

Применяется **только после ADR** о выборе Tailwind для libs/ui. Файл-цель:
`libs/ui/src/styles/tailwind-theme.css`. Источник значений — токены `--ph-*`
(скил `ui-standards-tokens`, `reference/ui-design-tokens.md`); здесь только ссылки на них.

## Полный маппинг

```css
/* Only after the ADR. Values are references to libs/ui tokens, never literals. */
@theme {
  --*: initial; /* drop Tailwind's default theme: no bg-blue-500, no p-13, no text-7xl */

  /* Media/container queries cannot use var() → literals mirroring ui-design-tokens.md §7 */
  --breakpoint-lg: 80rem;  /* 1280 — target POS screen */
  --breakpoint-xl: 100rem; /* 1600 */
  --breakpoint-2xl: 120rem;/* 1920 */
  --container-xs: 20rem;
  --container-sm: 24rem;
  --container-md: 28rem;
  --container-lg: 32rem;
  --container-xl: 36rem;
  --container-2xl: 42rem;
}

@theme inline {
  --color-bg: var(--ph-color-bg);
  --color-surface: var(--ph-color-surface);
  --color-surface-sunken: var(--ph-color-surface-sunken);
  --color-fg: var(--ph-color-fg);
  --color-fg-muted: var(--ph-color-fg-muted);
  --color-border: var(--ph-color-border);
  --color-control: var(--ph-color-border-control);
  --color-primary: var(--ph-color-primary);
  --color-primary-hover: var(--ph-color-primary-hover);
  --color-on-primary: var(--ph-color-on-primary);
  --color-danger: var(--ph-color-danger);
  --color-danger-hover: var(--ph-color-danger-hover);
  --color-on-danger: var(--ph-color-on-danger);
  --color-danger-subtle: var(--ph-color-danger-subtle);
  --color-warning: var(--ph-color-warning);
  --color-warning-subtle: var(--ph-color-warning-subtle);
  --color-success: var(--ph-color-success);
  --color-success-subtle: var(--ph-color-success-subtle);
  --color-info: var(--ph-color-info);
  --color-info-subtle: var(--ph-color-info-subtle);
  --color-disabled: var(--ph-color-disabled);
  --color-on-disabled: var(--ph-color-on-disabled);
  --color-focus-ring: var(--ph-color-focus-ring);

  /* One canonical spacing scale (numeric, 4px base). No --spacing base → p-13 does not exist */
  --spacing-0: var(--ph-space-0);
  --spacing-1: var(--ph-space-1);
  --spacing-2: var(--ph-space-2);
  --spacing-3: var(--ph-space-3);
  --spacing-4: var(--ph-space-4);
  --spacing-5: var(--ph-space-5);
  --spacing-6: var(--ph-space-6);
  --spacing-8: var(--ph-space-8);
  --spacing-10: var(--ph-space-10);
  --spacing-12: var(--ph-space-12);
  --spacing-16: var(--ph-space-16);
  /* Sizes via spacing namespace → min-h-touch-pos, size-touch, h-row-dense, w-pos-side */
  --spacing-touch: var(--ph-size-touch-min);
  --spacing-touch-pos: var(--ph-size-touch-pos);
  --spacing-touch-primary: var(--ph-size-touch-primary);
  --spacing-row-dense: var(--ph-size-row-dense);
  --spacing-row-compact: var(--ph-size-row-compact);
  --spacing-icon-sm: var(--ph-size-icon-sm);
  --spacing-icon-md: var(--ph-size-icon-md);
  --spacing-pos-side: var(--ph-pos-side-width);

  --font-sans: var(--ph-font-sans);
  --font-mono: var(--ph-font-mono);
  --default-font-family: var(--ph-font-sans);
  --default-mono-font-family: var(--ph-font-mono);
  --text-xs: var(--ph-font-size-xs);   --text-xs--line-height: var(--ph-line-height-xs);
  --text-sm: var(--ph-font-size-sm);   --text-sm--line-height: var(--ph-line-height-sm);
  --text-md: var(--ph-font-size-md);   --text-md--line-height: var(--ph-line-height-md);
  --text-lg: var(--ph-font-size-lg);   --text-lg--line-height: var(--ph-line-height-lg);
  --text-xl: var(--ph-font-size-xl);   --text-xl--line-height: var(--ph-line-height-xl);
  --text-2xl: var(--ph-font-size-2xl); --text-2xl--line-height: var(--ph-line-height-2xl);
  --text-3xl: var(--ph-font-size-3xl); --text-3xl--line-height: var(--ph-line-height-3xl);
  --font-weight-normal: var(--ph-font-weight-normal);
  --font-weight-medium: var(--ph-font-weight-medium);
  --font-weight-semibold: var(--ph-font-weight-semibold);
  --font-weight-bold: var(--ph-font-weight-bold);

  --radius-sm: var(--ph-radius-sm);
  --radius-md: var(--ph-radius-md);
  --radius-lg: var(--ph-radius-lg);
  --radius-full: var(--ph-radius-full);
  --shadow-sm: var(--ph-shadow-sm);
  --shadow-md: var(--ph-shadow-md);
  --shadow-lg: var(--ph-shadow-lg);
  --ease-standard: var(--ph-ease-standard);
  --ease-out: var(--ph-ease-out);
  --default-transition-duration: var(--ph-duration-fast);
  --default-transition-timing-function: var(--ph-ease-standard);
}
```

После `--*: initial` исчезают и анимации по умолчанию (`animate-spin`): нужные — объявить явно
(`--animate-spin` + `@keyframes`). Новый токен сначала появляется в `libs/ui` (ui-standards-tokens),
потом строкой маппинга здесь — не наоборот.


## Что получается в классах

| Токен libs/ui | Переменная темы | Утилиты |
|---|---|---|
| `--ph-color-primary` | `--color-primary` | `bg-primary`, `text-primary`, `border-primary`, `outline-primary` |
| `--ph-color-border-control` | `--color-control` | `border-control` |
| `--ph-space-4` | `--spacing-4` | `p-4`, `gap-4`, `m-4`, `w-4`, `inset-4` |
| `--ph-size-touch-pos` | `--spacing-touch-pos` | `min-h-touch-pos`, `size-touch-pos`, `min-w-touch-pos` |
| `--ph-size-row-dense` | `--spacing-row-dense` | `h-row-dense` |
| `--ph-font-size-lg` + line-height | `--text-lg` | `text-lg` (размер и интерлиньяж) |
| `--ph-radius-md` | `--radius-md` | `rounded-md` |
| `--ph-shadow-lg` | `--shadow-lg` | `shadow-lg` |
| `--ph-z-modal` | — (у z-index нет namespace темы) | `z-(--ph-z-modal)` |
| `--ph-duration-normal` | — | `duration-(--ph-duration-normal)` |

Статичные утилиты (`flex`, `grid`, `grid-cols-3`, `w-full`, `h-dvh`, `sr-only`, `tabular-nums`,
`border`, `line-clamp-2`) от сброса темы не зависят.

## Проверка маппинга

- Каждая строка `@theme inline` — `var(--ph-…)`; литералы только у `--breakpoint-*` и `--container-*`.
- Нет токена в libs/ui → нет строки маппинга (порядок: сначала токен, потом маппинг).
- Семантика, а не примитивы: `--color-primary: var(--ph-color-primary)`, не `var(--ph-green-700)`.
