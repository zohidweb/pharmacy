# Web Performance Optimization — Checklists, Examples & Tools (Pharmacy, Next.js static export)

Расширенный материал к `../SKILL.md`. Контекст: `apps/web` / `apps/admin` — Next.js с `output: 'export'`,
без SSR/Server Actions/middleware; данные только через REST `apps/api`; Chrome/Edge последние 2 версии,
POS-ПК точки, сенсорный экран от 10″. Код — TypeScript, идентификаторы английские, доменные термины —
из `docs/architecture/glossary.md` (product, batch, receipt, shift…). Конвенции React — скил `react-dev`.

Цифры в примерах — **шаблоны для заполнения своими замерами**, а не обещанный результат.

---

## Шаблон отчёта о замере

```markdown
## Performance audit — <экран/сценарий>, <дата>
Сборка: `npx nx build web` (<commit>), браузер: Chrome/Edge <версия>, устройство: <POS-ПК/модель>,
CPU throttling: <4×/6×/нет>, режим: облачная точка / офлайн-точка (localhost)

| Метрика | До | После | Цель |
|---|---|---|---|
| Скан → строка чека отрисована (`pos:scan-to-line`) | | | < 100 мс |
| Оплата → чек отправлен в печать (`pos:pay-to-print`) | | | ≤ 1 сек end-to-end |
| INP (Lighthouse Timespan / Performance → Interactions) | | | ≤ 200 мс |
| LCP страницы кассы | | | ≤ 2,5 с |
| CLS | | | ≤ 0,1 |
| First-load JS кассы (gzip) | | | ≤ 250 КБ (цель ≤ 200), `tools/bundle-budget.json` |
| Long tasks > 50 мс в сценарии | | | 0 на скан |

Найденные проблемы: …
Изменения (по одному, с замером после каждого): …
```

---

## Example 1: INP кассы при сканировании штрих-кода

Сканер USB HID «печатает» штрих-код как клавиатура за десятки миллисекунд и завершает `Enter`.
Если каждый символ идёт в `useState` общего экрана — на один скан приходится 10–15 коммитов React
всего дерева кассы.

**Before:**
```tsx
// Every keystroke re-renders the whole POS screen
export function PosScreen() {
  const [scanInput, setScanInput] = useState('');
  const [lines, setLines] = useState<ReceiptLine[]>([]);
  const { products } = usePosCatalog();

  return (
    <>
      <input
        value={scanInput}
        onChange={(e) => setScanInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const product = products.find((p) => p.barcodes.includes(scanInput)); // O(n) per scan
            if (product) setLines((prev) => [...prev, toReceiptLine(product)]);
            setScanInput('');
          }
        }}
      />
      <ReceiptLines lines={lines} />
      <CatalogPanel products={products} />
    </>
  );
}
```

**After — буфер без рендеров + индекс каталога:**
```tsx
'use client';
import { useEffect, useRef } from 'react';

const MAX_KEY_INTERVAL_MS = 50; // HID scanners type much faster than humans (configurable per store)
const MIN_BARCODE_LENGTH = 6;

/**
 * Maps a physical key to a barcode character. event.code, not event.key (ADR-0015): with the Tajik
 * or Russian layout active, a scanner in keyboard mode produces Cyrillic in event.key.
 */
function codeToChar(code: string): string | null {
  if (/^(Digit|Numpad)\d$/.test(code)) return code.slice(-1);
  if (/^Key[A-Z]$/.test(code)) return code.slice(-1);
  return code === 'Minus' || code === 'NumpadSubtract' ? '-' : null;
}

/** Collects scanner keystrokes in a ref; calls onScan only on Enter. Zero renders per character. */
export function useBarcodeScanner(onScan: (barcode: string) => void): void {
  const bufferRef = useRef('');
  const lastKeyAtRef = useRef(0);
  const onScanRef = useRef(onScan);

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.timeStamp - lastKeyAtRef.current > MAX_KEY_INTERVAL_MS) {
        bufferRef.current = '';
      }
      lastKeyAtRef.current = event.timeStamp;

      if (event.code === 'Enter' || event.code === 'NumpadEnter') {
        const barcode = bufferRef.current;
        bufferRef.current = '';
        if (barcode.length >= MIN_BARCODE_LENGTH) {
          event.preventDefault();
          performance.mark('pos:scan');
          onScanRef.current(barcode);
        }
        return;
      }
      const char = codeToChar(event.code);
      if (char !== null) {
        bufferRef.current += char;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}
```

```ts
// Build the barcode index once per catalog version, not on every scan
export function buildBarcodeIndex(products: readonly Product[]): Map<string, Product> {
  const index = new Map<string, Product>();
  for (const product of products) {
    for (const barcode of product.barcodes) index.set(barcode, product);
  }
  return index;
}

// In the POS feature:
const barcodeIndex = useMemo(() => buildBarcodeIndex(catalog.products), [catalog.version]);
useBarcodeScanner((barcode) => {
  const product = barcodeIndex.get(barcode); // O(1)
  if (product) addLine(product); // urgent update — do NOT wrap in startTransition
  else showNotFound(barcode);
});
```

Замечания:
- Фокус-менеджмент (скан при фокусе в поле количества/поиска) — задача UX; для производительности
  важно одно: ни одного `setState` на символ.
- Кэш каталога и цен держится в памяти и в IndexedDB (буфер перебоев связи); источник — REST API.
  IndexedDB — через `idb` (ADR-0015, модуль `shared/lib/offline-queue` и снимок каталога); Dexie не
  используется. Запись в IndexedDB — одной транзакцией, не сериализовать весь каталог на каждом скане.
- Деньги в строке чека — integer дирамы; форматирование — только при выводе (`libs/shared/util`).

**Замер операции без зависимостей:**
```tsx
// After the new line is committed and painted
useEffect(() => {
  if (performance.getEntriesByName('pos:scan', 'mark').length === 0) return; // line added manually
  requestAnimationFrame(() => {
    performance.mark('pos:line-painted');
    const m = performance.measure('pos:scan-to-line', 'pos:scan', 'pos:line-painted');
    performance.clearMarks('pos:scan');
    if (process.env.NODE_ENV !== 'production') console.debug('scan-to-line', Math.round(m.duration), 'ms');
  });
}, [lines.length]);
```
Метки видны в DevTools → Performance (дорожка Timings); `pos:scan-to-line` — гейт ADR-0009 для PR,
затрагивающих кассу (Playwright-сценарий читает измерение). Отправка таких метрик в проде —
мониторинг не выбран, вводится через ADR; до него не делать. Метрики — только на собственный
`apps/api`, без ПДн и без внешних SaaS (правило проекта про данные).

**Поиск длинных кадров после скана:**
```ts
new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    if (entry.duration > 100) console.debug('long animation frame', Math.round(entry.duration), entry);
  }
}).observe({ type: 'long-animation-frame', buffered: true });
```

---

## Example 2: Поиск по каталогу

**Локальная фильтрация большого списка** — ввод остаётся мгновенным, тяжёлая фильтрация отстаёт:
```tsx
const [query, setQuery] = useState('');
const deferredQuery = useDeferredValue(query);
const results = useMemo(
  () => searchProducts(catalogIndex, deferredQuery, { limit: 50 }),
  [catalogIndex, deferredQuery],
);
const isStale = query !== deferredQuery;
```

**Серверный поиск** — debounce ручного ввода + отмена устаревшего запроса:
```tsx
useEffect(() => {
  const term = query.trim();
  if (term.length < 2) return;

  const controller = new AbortController();
  const timer = window.setTimeout(() => {
    const params = new URLSearchParams({ search: term, limit: '20', offset: '0' });
    apiRequest<ProductListResponse>(`/api/v1/products?${params}`, { signal: controller.signal })
      .then(setResults)
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) setSearchError(error);
      });
  }, 250);

  return () => {
    window.clearTimeout(timer);
    controller.abort();
  };
}, [query]);
```
`apiRequest` — свой клиент API на `fetch` в `shared/api` (ADR-0015, скил `react-dev`): correlation ID,
таймаут, разбор problem+json; `axios` и другие HTTP-библиотеки не используются. Для списков на экране
тот же запрос обычно оборачивается в TanStack Query (`signal` из `queryFn` отменяет устаревший запрос). Имя параметра поиска сверить с контрактом в
`libs/shared/dto`. Ошибки не глотать — показывать пользователю.

---

## Example 3: Сокращение бандла web/admin

### Step 1: Диагностика без новых зависимостей
```powershell
npx nx build web --skip-nx-cache
# Размеры чанков статического экспорта (путь сверить: npx nx show project web)
Get-ChildItem apps/web/out/_next/static/chunks -Recurse -Filter *.js |
  Sort-Object Length -Descending | Select-Object -First 15 Name, Length
```
Плюс DevTools → Coverage на странице кассы: какие модули загружены, но не выполняются.
В зависимости от версии Next.js `next build` также печатает размеры по маршрутам.

### Step 2: Граф модулей — `next experimental-analyze` (ADR-0009)

Next.js 16 собирает Turbopack, поэтому анализатор — встроенный, без зависимостей:
```powershell
npx next experimental-analyze apps/web          # writes .next/diagnostics/analyze; --serve opens the UI on localhost
```
Функция экспериментальная: совместимость с `output: 'export'` проверяется на первом замере; запасной
путь — размеры чанков (Step 1) и скрипт бюджета (Step 4). Вывод анализатора прикладывается к PR,
повышающему бюджет.

`@next/bundle-analyzer` (dev-зависимость) допустим, только если проект переведён на сборку webpack: анализ отдельной сборки `--webpack` при боевой Turbopack-сборке показывает не тот бандл.

### Step 3: Типовые находки и исправления

**Бэкенд-валидация в клиентском бандле:**
```ts
// Before — value import pulls class-validator/class-transformer into the browser bundle
import { CreateReceiptDto } from '@pharmacy/shared-dto';

// After — type-only import is erased at compile time
import type { CreateReceiptDto } from '@pharmacy/shared-dto';
```
Алиас — по `tsconfig.base.json`. Включить `@typescript-eslint/consistent-type-imports` в линтере — дёшево и страхует.

**Тяжёлое и редкое — за `next/dynamic`:**
```tsx
'use client';
import dynamic from 'next/dynamic';

// Charts library (choice requires ADR) loads only on the reports page, only in the browser
const SalesChart = dynamic(() => import('./SalesChart').then((m) => m.SalesChart), {
  ssr: false, // allowed in Client Components; avoids build-time prerender of browser-only code
  loading: () => <div className="chart-skeleton" style={{ height: 320 }} />,
});
```
Кандидаты: графики отчётов, экран выгрузки 1С (CommerceML/XML), импорт прайсов, редакторы ролей
«модуль × действие × охват точек», модальные мастера. Не выносить то, что нужно в первые секунды кассы.

**`React.lazy` + `Suspense`** — эквивалент внутри уже клиентского дерева:
```tsx
const ShiftCloseDialog = lazy(() => import('./ShiftCloseDialog'));
// …
{isClosingShift && (
  <Suspense fallback={<DialogSkeleton />}>
    <ShiftCloseDialog shiftId={shiftId} />
  </Suspense>
)}
```

**Локали RU/TJ — только активная:**
```ts
export async function loadMessages(locale: 'ru' | 'tg'): Promise<Messages> {
  const mod = locale === 'ru' ? await import('./messages/ru.json') : await import('./messages/tg.json');
  return mod.default;
}
```
Коды локалей и расположение словарей — по `libs/shared/util` (i18n).

**Библиотеки vs нативные API:** даты и числа — `Intl.*`, уникальность — `Set`, копирование —
`structuredClone`. Любая новая библиотека — согласование (и проверка лицензии).

**Корневой layout:** в `app/layout.tsx`/провайдерах — только то, что нужно каждой странице
(сессия, HTTP-клиент, локаль, тема). Экраны admin не импортируются в web и наоборот (границы Nx).

### Step 4: Бюджет размера (без зависимостей)

У Next.js нет встроенных бюджетов, как в `angular.json`. Простой скрипт в `tools/`, запускать вручную
перед PR; в CI (GitHub Actions, ADR-0009) он входит в job **checks**, пока workflow-файлов нет — вручную.
ADR-0009 требует доработать его под учёт first-load маршрута кассы:
```js
// tools/check-bundle-budget.mjs — usage: node tools/check-bundle-budget.mjs apps/web/out
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const MAX_CHUNK_GZIP_KB = 150; // ADR-0009 starting ceilings; real budgets live in tools/bundle-budget.json
const MAX_TOTAL_GZIP_KB = 900;

const root = join(process.argv[2] ?? 'apps/web/out', '_next', 'static', 'chunks');
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (name.endsWith('.js')) files.push(path);
  }
};
walk(root);

let totalKb = 0;
const violations = [];
for (const file of files) {
  const kb = gzipSync(readFileSync(file)).length / 1024;
  totalKb += kb;
  if (kb > MAX_CHUNK_GZIP_KB) violations.push(`${file}: ${kb.toFixed(1)} KB gzip`);
}
console.log(`JS chunks: ${files.length}, total ${totalKb.toFixed(1)} KB gzip`);
if (totalKb > MAX_TOTAL_GZIP_KB) violations.push(`total ${totalKb.toFixed(1)} KB > ${MAX_TOTAL_GZIP_KB} KB`);
if (violations.length > 0) {
  console.error('Bundle budget exceeded:\n' + violations.join('\n'));
  process.exit(1);
}
```
Порядок бюджетов (ADR-0009): сейчас — стартовые потолки (first-load JS кассы ≤ 250 КБ gzip, чанк
≤ 150 КБ, весь JS приложения ≤ 900 КБ); после walking skeleton кассы — базовый замер, бюджет = замер
+ 10 % (округлить до 10 КБ, не выше потолка) в `tools/bundle-budget.json` с датой и commit; дальше
бюджеты только снижаются, повышение — с выводом анализатора в PR и одобрением фронтенд-лида.

---

## Example 4: Длинные списки (каталог, остатки по партиям, отчёты)

Порядок выбора — от простого к зависимости:

1. **Серверная пагинация** — стандарт API: `limit`/`offset`. Остатки выводятся из движений по
   партиям на сервере — не тянуть «все движения» на клиент, чтобы посчитать остаток в браузере.
2. **Показывать меньше** — 50 строк + «Показать ещё» / фильтры по точке, сроку годности (FEFO).
3. **`content-visibility: auto`** — браузер пропускает рендер невидимых блоков (Chrome/Edge поддерживают):
   ```css
   .stock-group {
     content-visibility: auto;
     contain-intrinsic-size: auto 480px; /* approximate height of one group */
   }
   ```
   Применять к блокам (группы карточек/строк, секции отчёта), а не к `<tr>` внутри `<table>` —
   на табличной раскладке эффект ненадёжен.
4. **Виртуализация** — в MVP нет. Только если 1–3 не хватает по замеру (профиль на CPU 4×, приложен
   к PR): `@tanstack/react-virtual` с одобрения фронтенд-лида (ADR-0009), с обвязкой доступности и
   печати; `react-window` отклонён. Учесть сенсорную прокрутку.

Строки списка: стабильный `key` (`product.id`, `batch.id`), дорогая строка — `React.memo` при
подтверждении профайлером, обработчики — через делегирование или `useCallback`, если строка мемоизирована.

---

## Example 5: Печать чека, шрифты и изображения в static export

### Печать чека 58/80 мм

```tsx
'use client';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

// Receipt is rendered into a dedicated root outside the app tree
export function ReceiptPrint({ receipt, onPrinted }: { receipt: ReceiptView; onPrinted: () => void }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => setTarget(document.getElementById('receipt-print-root')), []);

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    document.fonts.ready.then(() => {
      if (cancelled) return;
      performance.mark('pos:print-start');
      window.print(); // blocks until the dialog closes
      onPrinted();
    });
    return () => {
      cancelled = true;
    };
  }, [target, onPrinted]);

  return target ? createPortal(<ReceiptPaper receipt={receipt} />, target) : null;
}
```
```css
#receipt-print-root { display: none; }

@media print {
  #app-root { display: none; }           /* the heavy app is not laid out for print */
  #receipt-print-root { display: block; width: 80mm; } /* 58mm for narrow printers */
  @page { margin: 0; }
}
```
`#app-root` и `#receipt-print-root` — соседние элементы в корневом layout. Чек — только текст и
простая разметка, без изображений и тяжёлых шрифтов. Ширину бумаги и тихую печать без диалога
определяют драйвер принтера и настройки браузера на терминале — это решение эксплуатации, не код.

### Шрифты — self-hosted, с таджикскими буквами

Шрифт подключается не через `next/font`, а общим `@font-face` в `libs/ui/src/styles/fonts.css`
(одинаково для web и admin, ADR-0007); компоненты читают только `--ph-font-sans`:
```css
@font-face {
  font-family: 'TT Norms Pro';
  font-weight: 400;
  font-display: swap;
  src: url('../../assets/fonts/TTNormsPro-Regular.otf') format('opentype');
}
```
Сейчас файлы — `.otf`; перевод в subset-`woff2` уменьшит вес на старте кассы — делать с замером
«до/после».
- Файл шрифта должен покрывать Latin + `cyrillic` (U+0400–045F, U+0490–0491, U+04B0–04B1, U+2116) +
  **`cyrillic-ext` (U+0460–052F)**: Ғғ U+0492/0493, Ққ U+049A/049B, Ҳҳ U+04B2/04B3, Ҷҷ U+04B6/04B7,
  Ӣӣ U+04E2/04E3, Ӯӯ U+04EE/04EF. Только `cyrillic` — недостаточно.
- Не больше 2–3 начертаний; лишние веса = лишние килобайты на старте кассы.
- Subsetting — заранее, инструментом подготовки (в рантайм не попадает; инструмент — dev-зависимость, через ADR),
  либо взять готовые woff2-разбиения шрифта. Проверить лицензию шрифта на self-hosting.
- `next/font/google` не использовать: он скачивает шрифт с Google при сборке (внешний сервис).
- Проверка: строка «Ҳисоб, ҷавоб, қонун, ғалла, Тоҷикистон, рӯз, ӣ» → DevTools → Elements →
  Computed → Rendered Fonts должен показывать только ваш шрифт.

### Изображения

```js
// next.config.js — the default image optimizer needs a server; not available in static export
const nextConfig = { output: 'export', images: { unoptimized: true } };
```
- С `unoptimized` `next/image` отдаёт файл как есть: сжимать и конвертировать (WebP/AVIF) заранее,
  задавать `width`/`height` (или `fill` + контейнер с `aspect-ratio`) — против CLS.
- Кастомный `loader` имеет смысл только при собственном сервере изображений — новый компонент → ADR.
  Image-CDN (Imgix, Cloudinary и т.п.) — запрещено.
- Изображения товаров в каталоге кассы по умолчанию не грузить или грузить лениво (`loading="lazy"`):
  кассиру важнее скорость, чем картинка.

---

## Performance Checklist

### Касса (POS)
- [ ] Скан: буфер в `useRef`, обработка по `Enter`, ноль рендеров на символ
- [ ] Поиск товара по штрих-коду — `Map`-индекс, построенный один раз на версию каталога
- [ ] Добавление строки — срочное обновление; тяжёлая фильтрация — `useDeferredValue`/`startTransition`
- [ ] Ручной поиск: debounce ≈200–300 мс + `AbortController`; результаты ограничены `limit`
- [ ] Контекст кассы разделён; значения контекстов стабильны
- [ ] Запись в буфер перебоев (IndexedDB) — одна транзакция на операцию, без сериализации всего каталога
- [ ] Печать — отдельный print-контейнер, `#app-root` скрыт в `@media print`
- [ ] Замеры `pos:scan-to-line` / `pos:pay-to-print` на целевом железе; операция ≤ 1 сек end-to-end

### Bundle Size
- [ ] Корневой layout/провайдеры без тяжёлых модулей
- [ ] Тяжёлые/редкие экраны и виджеты — `next/dynamic` / `React.lazy` + `Suspense`
- [ ] `import type` для `libs/shared/dto`; `class-validator`/`reflect-metadata` отсутствуют в бандле web/admin
- [ ] Загружается только активная локаль
- [ ] Бюджет размера проверен скриптом перед PR (`tools/bundle-budget.json`, ADR-0009)
- [ ] Новые зависимости согласованы (лицензия, размер, ADR при необходимости)

### Списки
- [ ] Пагинация limit/offset на сервере; остатки считаются на сервере
- [ ] `content-visibility: auto` для крупных блоков вне экрана
- [ ] Виртуализация — только по замеру, `@tanstack/react-virtual` с одобрения фронтенд-лида (ADR-0009)
- [ ] Стабильные `key` по id сущности

### Images & Fonts
- [ ] `images: { unoptimized: true }` (или ADR на свой сервер изображений)
- [ ] У всех изображений `width`/`height` или `aspect-ratio`
- [ ] `@font-face` в `libs/ui/src/styles/fonts.css`, файл содержит `cyrillic-ext`, `font-display: swap`, ≤ 3 начертаний
- [ ] Ни одного ресурса с внешних доменов (шрифты, скрипты, изображения)

### CSS
- [ ] Нет неиспользуемых глобальных стилей в корневом layout
- [ ] Скелетоны и плейсхолдеры правильной высоты (против CLS)
- [ ] Анимации — только `transform`/`opacity`; на слабых POS — минимум анимаций

### Core Web Vitals Targets (пороги web.dev, «good»)
- [ ] LCP ≤ 2,5 с
- [ ] INP ≤ 200 мс (для скана — ориентир < 100 мс)
- [ ] CLS ≤ 0,1

### Static export и офлайн
- [ ] Нет кода, требующего сервер Next.js (SSR, Server Actions, Route Handlers с логикой, middleware)
- [ ] Код с `window`/`document`/`indexedDB` не выполняется при build-time prerender (в эффектах или `dynamic(..., { ssr: false })`)
- [ ] Кэш на reverse proxy: `/_next/static/*` — `immutable`, HTML — `no-cache` (согласовано с развёртыванием)
- [ ] Проверено на офлайн-точке (браузер → localhost при работающих Docker/API/PostgreSQL)

---

## Performance Tools

### Measurement (без новых зависимостей)
- **Chrome/Edge DevTools → Performance** — long tasks, Interactions (INP), Timings (`performance.mark`), CPU/Network throttling
- **Lighthouse в DevTools** — Navigation (загрузка), Timespan (поток: скан, поиск), Snapshot
- **DevTools → Coverage** — неиспользуемый JS/CSS на старте
- **DevTools → Rendering** — Layout Shift Regions, Paint flashing
- **React DevTools Profiler** — причины рендеров, «Highlight updates»; `next build --profile` для production
- **`performance.mark/measure`, `PerformanceObserver`** (`event`, `long-animation-frame`, `layout-shift`)

### Bundle Analysis
- `npx nx build web` + размеры `out/_next/static/chunks` + `tools/check-bundle-budget.mjs`
- `next experimental-analyze` — встроенный граф модулей Turbopack (ADR-0009); `@next/bundle-analyzer` — только при сборке webpack
- `web-vitals` (`onINP`/`onLCP`/`onCLS`, сборка `attribution`) — devDependency, только perf-сценарии Playwright и локальная отладка; в прод-бандл не попадает (ADR-0009)

### Не использовать
- PageSpeed Insights / CrUX для закрытых экранов (недоступны снаружи, и данные о страницах уходят вовне)
- Sentry, Datadog RUM, Vercel Analytics/Speed Insights и любые внешние RUM/аналитика — правило проекта
  запрещает отправку данных во внешние SaaS; мониторинг не выбран — вводится через ADR
- Bundlephobia и подобные онлайн-сервисы допустимы только как справка о публичном пакете, без загрузки кода проекта
