# Локализация RU/TJ и форматы (деньги TJS, даты, числа)

Реализации форматтеров живут в `libs/shared/util` (деньги, даты, i18n — по CLAUDE.md монорепо).
UI-кит и экраны их только вызывают. Примеры ниже показывают контракт; если в `libs/shared/util`
уже есть функция — использовать её, не дублировать.

Библиотека i18n (react-intl, i18next, next-intl…) не выбрана — новая зависимость, по
согласованию/ADR. До решения — простой словарь ключей в `libs/shared/util`.

## 1. Язык документа и строки

- `<html lang="ru">` или `<html lang="tg">` — меняется вместе с языком интерфейса (скринридеры,
  переносы, выбор глифов). Фрагмент на другом языке (название товара на TJ в RU-интерфейсе) —
  `lang` на элементе.
- Тексты не хардкодятся в компонентах `libs/ui`: подписи приходят пропсами (`label`, `aria-label`)
  уже локализованными; экраны берут их из словаря по ключу.
- Названия товаров хранятся в двух языках (карточка товара: названия RU/TJ) — показывается
  название на языке интерфейса с fallback на второе.

## 2. Длинные строки

Таджикские и русские строки заметно длиннее английских оригиналов макетов; названия препаратов и
МНН бывают очень длинными («Амоксициллин + Клавулановая кислота, таблетки п/о 875 мг + 125 мг»).

| Правило | Как |
|---|---|
| Бюджет длины | Макет выдерживает +40 % к самой длинной из RU/TJ строк |
| Кнопки | `min-inline-size`, без фиксированной ширины; допускается перенос на 2 строки; текст действия не обрезается |
| Названия в таблицах | Перенос до 2 строк (`line-clamp: 2`), полное название доступно (раскрытие строки / панель деталей); `title` — не единственный способ (на сенсорном экране hover нет) |
| Слова без пробелов | `overflow-wrap: anywhere` в ячейках и строках чека |
| Переносы | `hyphens: auto` работает только со словарём браузера; для `tg` не рассчитывать |
| Регистр | Не делать `text-transform: uppercase` для длинных подписей — хуже читается и удлиняет строку |

## 3. Глифы и шрифт

Таджикские буквы: **Ғ ғ Қ қ Ҳ ҳ Ҷ ҷ Ӣ ӣ Ӯ ӯ** (U+0492–U+04EF) — это диапазон `cyrillic-ext`
(U+0460–052F), а не базовый `cyrillic`. Если в файле шрифта их нет, браузер подставит их из
fallback-шрифта — «прыгающие» буквы посреди слова.

- Шрифт self-hosted (`next/font/local` в корневом layout, файлы — в репозитории), subset с
  `cyrillic` + `cyrillic-ext` + `latin`; CDN запрещены (офлайн-точки без интернета).
- Проверять обычное, жирное начертание и моноширинный шрифт чека: строка-тест
  `Ғ ғ Қ қ Ҳ ҳ Ҷ ҷ Ӣ ӣ Ӯ ӯ — 0123456789 смн`. DevTools → Computed → Rendered Fonts: все глифы
  одним семейством.
- Ввод с клавиатуры может дать `и` + комбинируемый макрон (U+0304) вместо `ӣ` — перед сравнением,
  поиском и печатью нормализовать `text.normalize('NFC')` (в утилите, не в компоненте).

## 4. Деньги: TJS, сомони и дирамы

1 сомони = 100 дирамов. **Во всех слоях — integer в дирамах** (`amountMinor`, `priceMinor`).
Перевод в сомони — только при отображении, через форматтер `libs/shared/util`.

Правила для UI:
- Пропсы денег именуются с суффиксом `Minor` и имеют тип `number` (safe integer).
- В компонентах запрещены `/ 100`, `* 100`, `toFixed`, `parseFloat`, `Number(inputValue)` для сумм.
- Ввод суммы (наличные, сдача) — строка → `parseMoneyToMinor` → integer; ошибки ввода — `null`,
  а не `NaN`.
- Таблицы: суммы выровнены вправо, `tabular-nums`; обозначение валюты — в заголовке колонки, а не в
  каждой ячейке.
- Обозначение валюты (например «смн») и формат для TJ-интерфейса — утвердить с заказчиком.

```ts
// libs/shared/util — contract sketch; the real implementation lives there
const CURRENCY_LABEL = 'смн'; // TJS is the only currency (ADR-0016); label — confirm with the customer

export function formatMoney(amountMinor: number, opts: { plainSpaces?: boolean } = {}): string {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new RangeError('Money must be an integer amount in dirams');
  }
  const sign = amountMinor < 0 ? '-' : '';
  const abs = Math.abs(amountMinor);
  const dirams = abs % 100;
  const somoni = (abs - dirams) / 100; // exact: integer division without float rounding
  const grouped = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(somoni);
  const text = `${sign}${grouped},${String(dirams).padStart(2, '0')} ${CURRENCY_LABEL}`;
  // Receipt printers may lack U+00A0/U+202F glyphs → plain spaces for print
  return opts.plainSpaces ? text.replace(/[  ]/g, ' ') : text;
}

export function parseMoneyToMinor(input: string): number | null {
  const match = /^\s*(\d{1,12})(?:[.,](\d{1,2}))?\s*$/.exec(input);
  if (!match) return null;
  const somoni = Number(match[1]);
  const dirams = Number((match[2] ?? '').padEnd(2, '0'));
  return somoni * 100 + dirams;
}
```

`formatMoney(123450)` → `1 234,50 смн` (разделитель групп — узкий неразрывный пробел из
`Intl` для `ru-RU`). Для локали `tg` поддержка в ICU браузера не гарантируется — поэтому
группировка берётся из `ru-RU`, а формат для обоих языков единый (проверить с заказчиком).

Валюта в системе одна — сомони (ADR-0016): ни выбора валюты, ни кода валюты у суммы, ни курсов в UI
нет; закупочные цены партий — тоже в дирамах.
Себестоимость штуки при делении упаковки округляется вверх — это вычисляет бэкенд, UI только
показывает.

## 5. Даты и время

- Формат: `dd.MM.yyyy`, время `HH:mm` (24 ч) — одинаково для RU и TJ.
- Часовой пояс: `Asia/Dushanbe` (UTC+5, без перехода на летнее время) — задаётся явно в
  `Intl.DateTimeFormat({ timeZone })`, а не берётся из настроек ПК кассы.
- **Срок годности — date-only значение** (`'2026-11-12'`). Не пропускать через `new Date(...)`:
  парсинг как UTC и вывод в локальной зоне даёт сдвиг на день. Форматировать строку напрямую.

```ts
// libs/shared/util — contract sketch
export function formatDateOnly(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return `${d}.${m}.${y}`;
}

const dateTimeFormat = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Asia/Dushanbe',
  day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
export const formatDateTime = (isoInstant: string) => dateTimeFormat.format(new Date(isoInstant));
```

## 6. Числа и количества

- Количество с учётом делимости упаковки («2 уп. 3 шт.») — форматтер `libs/shared/util` по данным
  товара, не склейка строк в компоненте.
- Десятичный разделитель — запятая (RU и TJ); в полях ввода принимать и точку, и запятую.
- Штрих-коды и номера документов — моноширинно или `tabular-nums`, без группировки.

## 7. Сортировка и поиск

Сортировка списков по названию — на бэкенде (пагинация limit/offset). Если сортировка на клиенте
неизбежна — `Intl.Collator` c `['tg', 'ru']` и проверка, что браузер реально поддерживает `tg`
(`Intl.Collator.supportedLocalesOf(['tg'])`); иначе порядок таджикских букв будет неверным.
