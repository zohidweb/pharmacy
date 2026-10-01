# @pharmacy/ui — UI-кит web и admin

Собственный кит на нативной платформе Chrome/Edge (ADR-0007): Tailwind CSS v4 поверх токенов
`--ph-*`, без UI-зависимостей в рантайме. Каталог всех компонентов в dev-режиме:
`npx nx dev admin` → http://localhost:4300/dev/ui-kit (в продакшн-сборке маршрут отдаёт 404).

## Состав

| Группа      | Компоненты                                                                                                                                 | Основа                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| Кнопки      | `Button` (primary / secondary / tertiary / destructive / success, md / lg, loading), `buttonClassName` для ссылок, `IconButton`, `Spinner` | `<button>`                                                |
| Поля        | `TextField`, `TextareaField`, `Select`, `OtpField`, `Field` (обёртка label + hint + error)                                                 | `<input>`, `<textarea>`, `<select>` (`base-select`)       |
| Выбор       | `Checkbox`, `RadioCardGroup`, `Switch`                                                                                                     | нативные `checkbox` / `radio`, `role="switch"`            |
| Отображение | `StatusPill`, `CountBadge`, `Chip` / `ChipGroup`, `Avatar`, `Card` / `CardHeader`, `Alert`, `KpiTile`, `EmptyState`, `Stepper`             | —                                                         |
| Навигация   | `Tabs` (ARIA APG, roving tabindex), `SegmentedControl`, `Pagination` (limit/offset)                                                        | —                                                         |
| Оверлеи     | `Dialog`, `Popover`, `ToastProvider` / `useToast`                                                                                          | `<dialog>`, Popover API + anchor positioning, `aria-live` |
| Данные      | `DataTable` (caption, `aria-sort`, пустое состояние), `BarChart` (данные дублируются скрытой таблицей)                                     | `<table>`                                                 |
| Иконки      | `Icon` — 49 иконок Lucide (ISC), см. `THIRD_PARTY_NOTICES.md`                                                                              | inline SVG                                                |

## Правила

- Стили — только утилиты из токенов (`src/styles/tailwind-theme.css`); arbitrary values, палитра
  Tailwind по умолчанию, `dark:` и модификаторы прозрачности запрещены. Новый токен — сначала в
  `src/styles/tokens/`, затем строкой маппинга.
- Внешний `className` компонента — только раскладка (отступы, место в сетке).
- Кит не содержит текстов: подписи, `aria-label` и сообщения приходят пропсами уже локализованными.
- Статус — всегда иконка и текст, не только цвет. Деньги — только через `@pharmacy/shared-util`.
- Каждый интерактивный компонент: чек-лист ARIA APG в шапке файла, тест клавиатурного сценария и
  проверка `jest-axe` (ADR-0009, ось Е).

`npx nx test ui` — unit-тесты (Jest + Testing Library + jest-axe).
