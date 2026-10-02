# UI Accessibility Patterns — Pharmacy (WCAG 2.1 AA)

Цель — WCAG 2.1 уровня AA для `apps/web` и `apps/admin`. Касса — сенсорный экран от 10″ +
физическая клавиатура + сканер штрих-кода USB HID; всё должно работать любым из способов.

## 1. Критерии, которые чаще всего нарушают

| Критерий | Что это значит у нас |
|---|---|
| 1.1.1 Нетекстовое содержимое | Иконки-кнопки — с `aria-label` (локализованным); декоративные иконки — `aria-hidden="true"` |
| 1.3.1 Информация и связи | Таблицы — `<table>`/`<th scope>`, формы — `<label htmlFor>`, группы — `<fieldset>`/`<legend>` |
| 1.4.1 Использование цвета | Статус = иконка + текст + цвет (§5); ошибка поля = текст + рамка |
| 1.4.3 Контраст текста | 4.5:1; крупный текст (≥ 24 px или ≥ 18.66 px bold) — 3:1 |
| 1.4.4 Масштаб до 200 % | Размеры в `rem`, без фиксированной высоты у текстовых контейнеров |
| 1.4.11 Контраст нетекстовых элементов | Рамки полей, чекбоксы, иконки состояния, кольцо фокуса — 3:1 к соседнему цвету |
| 1.4.13 Содержимое по hover/focus | Тултипы закрываются по Esc, не перекрывают целевой элемент; на сенсорном экране hover нет — важное не прятать в тултип |
| 2.1.1 Клавиатура | Каждое действие доступно с клавиатуры; нет «только свайп/долгое нажатие/drag» |
| 2.1.2 Нет ловушек | Модалка удерживает фокус, но закрывается Esc и возвращает фокус |
| 2.2.1 Регулируемое время | Таймаут сессии (настройка сети тенанта) — предупреждение заранее с возможностью продлить |
| 2.4.3 Порядок фокуса | DOM-порядок = визуальный; `tabIndex > 0` запрещён |
| 2.4.7 Видимый фокус | Глобальный `:focus-visible` из `base.css`; `outline: none` без замены запрещён |
| 3.1.1 / 3.1.2 Язык | `<html lang="ru|tg">`; фрагмент на другом языке — `lang` на элементе (§ localization) |
| 3.3.1 / 3.3.3 Ошибки ввода | Текст ошибки рядом с полем, `aria-describedby`, `aria-invalid`; подсказка, как исправить |
| 4.1.2 Имя, роль, значение | Нативные элементы прежде ARIA; кастомный контрол — полный набор role/state |
| 4.1.3 Сообщения о статусе | Результат скана, «чек отложен», «нет связи» — через live-регион без переноса фокуса (§4) |

Касса — плотный 2D-интерфейс под экран ≥ 1280 px; перестройка под 320 px (1.4.10) для таблиц и
экрана кассы не требуется самим критерием (исключение для содержимого с двумерной раскладкой), но
при масштабе 200 % функции не должны теряться (прокрутка панели допустима).

## 2. Сенсорные цели

| Контекст | Минимум | Токен |
|---|---|---|
| Любая интерактивная цель `apps/web` | 44×44 px | `--ph-size-touch-min` |
| Кнопки, цифры экранной клавиатуры, строки выбора на кассе | 48×48 px | `--ph-size-touch-pos` |
| Главные действия кассы (Оплатить, Отложить, Подтвердить возврат) | высота 64 px | `--ph-size-touch-primary` |
| Строка плотной таблицы (склад, отчёты) на сенсорном экране | 44 px | `--ph-size-row-dense` |
| `apps/admin` при `data-density="compact"` (мышь) | 36 px | `--ph-size-row-compact` |
| Зазор между соседними целями | 8 px | `--ph-space-2` |

- Область касания расширять паддингом/`min-block-size`, не `transform: scale`.
- Опасные действия (удалить строку чека, аннулировать) не ставить вплотную к частым (добавить
  количество) — зазор ≥ `--ph-space-4` или подтверждение.
- Нет hover-only функций: всё, что появляется по hover, должно быть доступно касанием и фокусом.
- Иконка-кнопка без текста на кассе — исключение; предпочтительно иконка + подпись.

## 3. Клавиатура и сканер штрих-кода

Сканер USB HID — это клавиатура: серия символов за десятки миллисекунд + Enter. Распознавание —
собственный обработчик по `event.code` с настраиваемыми порогами (ADR-0015 п. 7: `libs/ui` или
`apps/web/src/shared/lib`); что делать со сканом, решает срез экрана кассы (`apps/web/src/pages/pos`
и его features, FSD). UI-кит обеспечивает предсказуемый фокус.

Правила экрана кассы:
- Поле скана/поиска — фокус по умолчанию при открытии экрана. После закрытия любого диалога,
  оплаты, отложенного чека фокус возвращается в него.
- Фокус не «воруется» таймерами и уведомлениями: toast/live-регион не принимают фокус.
- Модальный диалог (количество, выбор партии, оплата) — сканер и Enter работают внутри него
  предсказуемо: Enter = основное действие, Esc = отмена.
- Горячие клавиши — единый задокументированный набор (например, F-клавиши для «Оплатить»,
  «Отложить», «Поиск аналога по МНН»); подпись клавиши видна на кнопке (`<kbd>`). Не занимать
  клавиши браузера без крайней необходимости: F5 (перезагрузка — потеря незавершённой операции),
  Ctrl+P, F11, F12. Конкретный набор — согласовать с заказчиком.
- Поле скана: `autoComplete="off"`, `spellCheck={false}`, `inputMode="none"` только если на экране
  есть своя цифровая клавиатура (иначе системная экранная клавиатура нужна).

```tsx
// Pattern: native <dialog> — Esc, top layer, focus management out of the box
import { useEffect, useRef, type ReactNode, type RefObject } from 'react';

interface ModalProps {
  open: boolean;
  onClose: () => void; // must be idempotent: also fires after a programmatic close
  labelledBy: string;
  returnFocusTo?: RefObject<HTMLElement | null>;
  children: ReactNode;
}

export function Modal({ open, onClose, labelledBy, returnFocusTo, children }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={labelledBy}
      onClose={() => {
        onClose();
        returnFocusTo?.current?.focus(); // e.g. back to the scan input
      }}
    >
      {children}
    </dialog>
  );
}
```

Стиль подложки: `dialog::backdrop { background: var(--ph-color-overlay); }`.

## 4. Live-регионы (сообщения о статусе)

```tsx
// Mounted once on the POS screen; text changes are announced, focus stays in the scan input
<div role="status" aria-live="polite" className="ph-visually-hidden">
  {lastScanMessage /* localized: "Добавлено: Парацетамол 500 мг, 1 уп." */}
</div>

// Errors that need immediate attention (unknown barcode, expired batch blocked)
<div role="alert">{errorMessage}</div>
```

- Индикатор связи («Нет связи — операции в буфере: 3») — видимый текст + иконка в шапке кассы,
  изменение объявляется `role="status"`.
- Не объявлять каждое нажатие клавиши и не дублировать объявления.

## 5. Статусы партий и другие состояния — не только цветом

| Статус партии | Токены | Иконка (смысл) | Текст (пример RU) |
|---|---|---|---|
| Истекает срок (`expiring-soon`) | `--ph-batch-expiring-*` | часы / предупреждение | «Истекает 12.11.2026» |
| Просрочено (`expired`) | `--ph-batch-expired-*` | запрет / крест | «Просрочено» |

Общий примитив — `StatusPill` (`libs/ui/src/lib/display/StatusPill.tsx`): тон → классы токенов,
иконка из своего SVG-набора (`Icon`, `aria-hidden`) и видимый текст. Доменный бейдж только
сопоставляет статус тону и подписи:

```tsx
// BatchStatusBadge — domain mapping onto the kit primitive (the status union comes from
// @pharmacy/shared-domain when defined there; shown inline for the example)
import { StatusPill, type StatusTone } from '@pharmacy/ui';

export type BatchStatus = 'expiring-soon' | 'expired';

const tone: Record<BatchStatus, StatusTone> = {
  'expiring-soon': 'warning',
  expired: 'danger',
};

export function BatchStatusBadge({ status, label }: { status: BatchStatus; label: string }) {
  return <StatusPill tone={tone[status]}>{label /* localized by the caller */}</StatusPill>;
}
```

Иконки — только из набора `libs/ui/src/lib/icon` (`IconName`); пакеты иконок не подключаются
(ADR-0007 п. 6), недостающая иконка добавляется в `icons.ts` с указанием источника и лицензии.

То же правило — для строк таблицы остатков: просроченная партия в списке помечается бейджем, а не
только красным фоном строки; строка чека с ПКУ-препаратом — иконкой + текстом «ПКУ».

## 6. Фокус и видимость

- Фокус глобально: `:focus-visible { outline: var(--ph-focus-ring-width) solid var(--ph-color-focus-ring); }`.
  В компонентах не переопределять, кроме смещения (`outline-offset`) для особых форм.
- Кольцо фокуса ≥ 3:1 к фону (синий `--ph-color-focus-ring` на белом и на `surface-sunken`).
- Элемент в фокусе не должен уходить под липкую шапку/панель действий:
  `scroll-padding-block: <высота панели через токен>` на скролл-контейнере.
- `forced-colors: active` (режим высокой контрастности Windows): не полагаться на фон как
  единственную границу кнопки — у кнопок есть `border` (прозрачный в обычном режиме).

## 7. Семантика форм и таблиц

- Каждое поле — видимый `<label>`; placeholder не заменяет label.
- Обязательность — текстом («обязательно») и `aria-required`, не только звёздочкой.
- Ошибки: `aria-invalid="true"`, `aria-describedby` на id текста ошибки; при отправке формы —
  фокус на первое поле с ошибкой.
- Таблицы: `<caption>` (можно визуально скрытый), `<th scope="col">`; сортируемая колонка —
  кнопка в заголовке и `aria-sort` на `<th>`; числа выровнены вправо, `tabular-nums`.

## 8. Reduced motion

Токены длительности обнуляются при `prefers-reduced-motion: reduce` (см. ui-design-tokens.md §6).
В JS-анимациях (если появятся) проверять `window.matchMedia('(prefers-reduced-motion: reduce)')`.

## 9. Проверка

- Ручной проход сценариев кассы только клавиатурой: скан → количество → оплата → печать → фокус в
  поле скана.
- Масштаб браузера 200 % и масштаб Windows 125 % на 1280×800.
- Chrome DevTools: Lighthouse Accessibility, панель Accessibility (имя/роль), эмуляция
  `prefers-reduced-motion` и `forced-colors`.
- Автоматически (ADR-0009): `jest-axe` в тестах компонентов `libs/ui`, `@axe-core/playwright` в e2e
  на ключевых экранах (вход, касса скан → оплата, приёмка, возврат); гейт — 0 нарушений
  serious/critical. Автоматика не заменяет ручной проход выше.
