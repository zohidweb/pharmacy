# Печать чеков 58/80 мм (печать браузера)

Чек печатается через `window.print()` в Chrome/Edge на термопринтер 58 или 80 мм (драйвер ОС).
Состав и реквизиты фискального чека определяет фискализация (адаптер, в MVP — заглушка; вопрос № 9
stack.md) — UI-кит отвечает только за вёрстку. Печать без диалога (kiosk printing) — настройка
браузера/терминала, вне UI-кита; согласовать с эксплуатацией.

## 1. Принципы

| Правило | Почему |
|---|---|
| Отдельный print-корень, остальное приложение в печати скрыто | Печать не тянет вёрстку всего экрана кассы; быстрее и предсказуемее |
| Моноширинная сетка по колонкам (`ch`) | Термопринтеры и их пользователи привыкли к «колоночному» чеку; ширина предсказуема |
| Только чёрный на белом, без фонов, теней, серого | Термопечать не передаёт полутона; серый превращается в «грязь» |
| `@page { margin: 0 }` | Размер бумаги задаёт драйвер; без полей Chrome не печатает колонтитулы (URL, дату) |
| Размеры печати — `mm`/`pt` только в `print.css` | Единственное место, где физические единицы уместны |
| Дождаться `document.fonts.ready` перед `window.print()` | Иначе первый чек печатается fallback-шрифтом |

## 2. Токены печати — `libs/ui/src/styles/tokens/print.css`

```css
:root {
  --ph-receipt-font: var(--ph-font-mono);
  --ph-receipt-font-size: 8pt;      /* start value; calibrate on real printers */
  --ph-receipt-line-height: 1.25;
  --ph-receipt-padding-inline: 1mm;
  --ph-receipt-cols: 32;
  --ph-receipt-width: 48mm;         /* printable width of 58 mm paper */
}

[data-receipt-width='80'] {
  --ph-receipt-cols: 42;            /* 42–48 depending on font size and printer */
  --ph-receipt-width: 72mm;         /* printable width of 80 mm paper */
}
```

Стартовые значения: 58 мм — ~48 мм печатной ширины, 32 колонки; 80 мм — ~72 мм, 42–48 колонок.
Кегль подбирается так, чтобы `cols × 1ch` ≤ печатной ширины; калибровка — на реальных принтерах
точек, ширина — настройка точки/терминала.

## 3. Разметка и стили

```tsx
// libs/ui/src/lib/ReceiptPrint/ReceiptPrint.tsx
import { createPortal } from 'react-dom';
import styles from './ReceiptPrint.module.css';

export interface ReceiptPrintProps {
  paperWidth: '58' | '80';
  lines: readonly string[]; // pre-formatted fixed-width lines (see §4)
}

export function ReceiptPrint({ paperWidth, lines }: ReceiptPrintProps) {
  return createPortal(
    <div data-print-root data-receipt-width={paperWidth} className={styles.receipt}>
      {lines.map((line, i) => (
        <div key={i} className={styles.line}>{line}</div>
      ))}
    </div>,
    document.body,
  );
}
```

```css
/* ReceiptPrint.module.css */
.receipt {
  display: none; /* screen: hidden; preview is a separate on-screen component */
}

@media print {
  .receipt {
    display: block;
    inline-size: min(var(--ph-receipt-width), calc(var(--ph-receipt-cols) * 1ch));
    padding-inline: var(--ph-receipt-padding-inline);
    font-family: var(--ph-receipt-font);
    font-size: var(--ph-receipt-font-size);
    line-height: var(--ph-receipt-line-height);
    color: black;          /* ignore-design: thermal print is monochrome by definition */
    background: none;
  }
  .line {
    white-space: pre-wrap; /* keep column padding, wrap overflow */
    overflow-wrap: anywhere;
    break-inside: avoid;
  }
}
```

```css
/* libs/ui/src/styles/base.css — global print rules */
@media print {
  @page {
    margin: 0;
  }
  body > :not([data-print-root]) {
    display: none !important; /* ignore-design: only the print root may reach the printer */
  }
  * {
    box-shadow: none !important;
    print-color-adjust: economy;
  }
}
```

```ts
// Feature code (apps/web/src/features/pos): print after fonts are ready
export async function printReceipt(): Promise<void> {
  await document.fonts.ready;
  window.print();
}
```

`print:`-варианты Tailwind (если ADR его выберет) — только для скрытия элементов экрана;
вёрстка чека остаётся в этом CSS.

## 4. Моноширинная сетка строк

Строки чека собираются в TS фиксированной ширины (`cols`) — так результат одинаков в предпросмотре и
на бумаге. Утилита — в `libs/shared/util` (рядом с `formatMoney`):

```ts
// Pads left/right parts into a fixed-width line; long left text wraps onto its own lines.
export function receiptRow(left: string, right: string, cols: number): string[] {
  const l = left.normalize('NFC');
  const r = right.normalize('NFC');
  if (l.length + 1 + r.length <= cols) {
    return [l + ' '.repeat(cols - l.length - r.length) + r];
  }
  const wrapped: string[] = [];
  for (let i = 0; i < l.length; i += cols) wrapped.push(l.slice(i, i + cols));
  wrapped.push(r.padStart(cols));
  return wrapped;
}
```

Пример (32 колонки):

```
Парацетамол 500 мг, таб. №10
  2 x 12,50               25,00
ИТОГО                    125,00
Наличные                 200,00
Сдача                     75,00
```

- Суммы печатаются `formatMoney(x, { plainSpaces: true })` без обозначения валюты в строках
  (валюта — одной строкой в итоге/шапке): у термошрифтов часто нет U+00A0/U+202F.
- Таджикские буквы — предсоставные символы (1 символ = 1 колонка) после `normalize('NFC')`;
  моноширинный шрифт чека обязан содержать `cyrillic-ext`, иначе колонки «поедут».
- Выделение итога — `font-weight: bold` или двойной разделитель `====`, не цвет и не размер
  больше 2× (перенос сломает сетку).
- Длина разделителей и строк — всегда от `cols`, не хардкод.

## 5. Проверка

1. Chrome → печать → предпросмотр для 58 и 80 мм: нет колонтитулов, нет лишних страниц,
   колонки ровные.
2. Строки с длинным названием препарата и таджикскими буквами.
3. Печать на реальном принтере каждой модели, используемой в точках (калибровка кегля/колонок).
4. Чек печатается и на офлайн-точке (шрифт локальный, без сети).
