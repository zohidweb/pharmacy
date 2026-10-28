# Ценники со штрихкодом и QR на чеке: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ценники для полки печатаются из карточки товара и из остатков (штрихкод, название, цена точки). На чеке
продажи печатается QR с id чека, и экран возврата находит чек по скану этого QR.

**Architecture:** линейные штрихкоды (EAN-13, EAN-8, UPC-A, Code 128) — свой код в `apps/web/src/shared/lib/barcode`,
QR — библиотека `lean-qr` 2.7.4, только в `apps/web`; рисунки — SVG. Печать — через диалог браузера:
- ценники — отдельный корень печати `LabelPrint` (`libs/ui`) с именованными страницами 58 × 40 и 40 × 30 мм;
- QR — новое место для рисунка после строк в `ReceiptPrint` и `ReceiptPreview`.

API не меняется.

**Tech Stack:** TypeScript, React, SVG, CSS paged media (`@page` с размером), `lean-qr` 2.7.4 (MIT, без зависимостей).

**Spec:**
- ADR-0022 `docs/architecture/adr/0022-shtrihkody-i-qr.md` (сейчас `proposed`; утверждение плана — его принятие).
- ТЗ клиентского продукта v3.1:
  - раздел 10 — «Печать ценников для полки в торговом зале (штрихкод, название, цена) на основе карточки товара —
    отдельно от печати чека»;
  - раздел 7 — «Продажа находится по номеру чека или сканированию QR-кода с чека».
- Макеты (`UI mockups для клиентского продукта.zip`):
  - `product.dc.html` — окно «Печать ценника»: точка с ценой, «Размер ценника» 58 × 40 / 40 × 30 мм, «Копий»,
    предпросмотр, подсказка «Ценник печатается отдельно от чека: штрихкод, название и цена выбранной точки.»;
  - `stock.dc.html` — массовые «Печать ценников»;
  - `return.dc.html` — «Номер чека или QR с чека».
- `docs/qa/02-granitsy-pilota.md`, раздел 2: строки «Ценники и штрихкоды» и «QR-код на чеке».
- Спецификация `2026-10-26-pilot-small-gaps-design.md`: подсказка возврата без QR, «QR на чеке — после ADR о штрихкодах».

## Решения автора (утверждение плана — принятие ADR-0022)

| № | Вопрос | Решение |
|---|---|---|
| T1 | Инструменты | По ADR-0022. Линейные коды — свой код. QR — `lean-qr`, ровно `2.7.4`, в `dependencies` корневого `package.json`; импортирует его только `apps/web/src/shared/lib/barcode/qr.ts`. Кит `libs/ui` остаётся без рантайм-зависимостей: он получает место для рисунка в чеке и корень печати этикеток, но не кодировщики |
| T2 | Символика ценника | По первому штрихкоду товара. 13 цифр с верной контрольной цифрой — EAN-13; 12 — UPC-A, печатается как EAN-13 с ведущим `0`; 8 — EAN-8. Цифры с неверной контрольной цифрой и любая другая печатная латиница (ASCII 32–126) — Code 128, набор B. Code 128 — не длиннее 16 знаков на 58 × 40 и 10 знаков на 40 × 30. Кириллица, слишком длинный код или товар без штрихкода — штрихов нет, код (если есть) — текстом. Под штрихами — цифры кода |
| T3 | Ценник | Название — на языке интерфейса (`nameTj` при TJ и непустом, иначе `nameRu`), до 3 строк, дальше многоточие. Строка деталей: из карточки — «производитель · страна · уп. N шт.», из остатков — «уп. N шт.». Штрихкод. Цена упаковки точки крупно, «4,50 с». Товара без цены в точке ценник не печатается. Цены штуки на ценнике нет (ADR-0022, последствия) |
| T4 | Размеры | 58 × 40 мм (по умолчанию) и 40 × 30 мм. Поля этикетки — 2 мм. Высота штрихов — 12 и 8 мм. Модуль штриха — по ширине этикетки, не меньше 0,25 мм. Размеры — токены `--ph-tag-*` в `libs/ui/src/styles/tokens/print.css` |
| T5 | Печать ценников | `LabelPrint` (`libs/ui`): корень печати `ph-print-root ph-print-labels` с `data-label-size`; именованные страницы `label-58x40` и `label-40x30`, `margin: 0`; одна этикетка на страницу (`break-after: page`, у последней — нет). Копии — повтор этикетки. Кнопка «Печать» вызывает `printDocument` |
| T6 | Карточка товара | «Печать ценника» активна, если у товара есть цена хотя бы в одной точке охвата (`prices.get`). Окно: точка с ценой («Аптека №3 — 4,80 с», по умолчанию текущая точка сессии, иначе первая), размер, копии (1–100, по умолчанию 1), предпросмотр одного ценника, подсказка из макета, «Печать» |
| T7 | Остатки | «Ценники» на панели выбранных строк. Строки сводятся к парам «точка × товар» с ценой. Окно: размер, копии, число ценников, предпросмотр первого, «Печать». Строки без цены пропускаются с примечанием «Без цены в точке — не напечатаны: N» |
| T8 | QR на чеке | На чеке продажи после подвала — QR id чека (`request.id`, UUIDv7, 36 знаков ASCII), коррекция M, сторона 20 мм (`--ph-receipt-qr-size`), по центру. Есть и в предпросмотре окна чека. Чек без связи тоже получает QR: библиотека в бандле. У Z-отчёта и в истории смен QR нет |
| T9 | Возврат | Поле — «Номер чека или QR с чека» (макет), подсказка — «Отсканируйте QR с чека или введите номер. У чека без связи — код из 8 знаков». Скан UUID уже ищет чек по id (`findByCode`), сканер читает латиницу по `event.code` |
| T10 | Права | Новых прав нет. Ценник показывает только розничную цену: печатает тот, кто видит карточку товара (`catalog:view`) или остатки (`inventory:view`). QR печатается вместе с чеком |
| T11 | Документы | ADR-0022 → `accepted` и строка APPROVAL.md. CLAUDE.md и stack.md, «Фронтенд-библиотеки»: `lean-qr`; «свои: … штрихкоды ценников». «Границы пилота»: строки «Ценники и штрихкоды» и «QR-код на чеке» уходят из раздела 2, поведение — в раздел 3. Отметка в спецификации pilot-small-gaps |
| T12 | Вне плана | Цена штуки на ценнике. Этикетки на вскрытую упаковку (ТЗ, вне MVP). Ценники из прихода и переоценки. Шаблоны ценника сети. Агент печати. Штрихкод номера чека для 1D-сканеров. QR на документах возврата |

## Global Constraints

- **Тесты** отложены до MVP: проверка живая, существующие наборы остаются зелёными. Кодировщики (EAN, Code 128) и выбор
  символики — первые кандидаты на unit-тесты после MVP; строка в описании PR.
- **Читаемость проверяется декодером.**
  - `@zxing/library` 0.23.0 (Apache-2.0) ставится только во временную папку scratchpad (`npm install --prefix`) для
    проверки и в проект не попадает. Установка — с согласия пользователя: утверждение плана.
  - Страница проверки в scratchpad рисует SVG ценников и QR в canvas и декодирует их в in-app браузере.
  - Размер страниц печати проверяется PDF из headless Chrome: `MediaBox` в pt.
- **Зависимость:** `lean-qr` — ровно `2.7.4` (как `idb`, `uuid`); `npm install` меняет `package-lock.json` только
  записью `lean-qr`.
- **Сборка:** `next build` проверяет типы по `libs/*/dist`; после правок `libs/ui` выполнить
  `npx nx run-many -t typecheck -p ui shared-util shared-dto shared-domain --skip-nx-cache`.
- **Стенд** — как в выгрузке Excel:
  - копия dev-БД `pharmacy_tags_check`, обёртка `.env`, API из `apps/api/dist`, web `web-partial-4210`;
  - синтетические сотрудники — по новым кодам активации; касса привязывается на копии;
  - после проверки удалить копию, конфигурации, scratchpad и выйти из сессий.
- **Оформление:**
  - Prettier — только для файлов, отформатированных на HEAD;
  - регулярные выражения и строки с `\` — через Edit, байты проверить `od -c`;
  - коммиты — `--no-gpg-sign`, Conventional Commits, `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`;
  - тексты TJ — с отметкой для ревью TJ.

## Review Focus

1. **Значения штрихкода:** `4006381333931`, `036000291452` (UPC-A), `96385074` (EAN-8), 13 цифр с неверной контрольной,
   `000123`, `ABC-123/x`, кириллица, 30 знаков. Ожидается: верная символика или текст без штрихов, никогда — EAN с чужой
   контрольной цифрой. Декодер возвращает исходное значение. Проверка — задача 1, b1.
2. **QR id чека** декодируется в те же 36 знаков; скан на экране возврата находит чек — и чек без связи после досылки.
   Проверка — задача 1, b2; задача 3, q2.
3. **Копии и несколько товаров:** 3 товара × 2 копии дают ровно 6 страниц нужного размера, без пустой последней.
   Длинное название не выталкивает цену с этикетки. Проверка — задача 2, p2, p3.
4. **Товар без цены в точке, без штрихкода, с несколькими штрихкодами:** без цены — нет ценника и есть примечание; без
   штрихкода — ценник без штрихов; несколько штрихкодов — первый. Проверка — задача 2, p4.
5. **TJ:** название на ценнике — `nameTj`, если интерфейс TJ и оно задано. Знак валюты — «с». Проверка — задача 2, p5.

---

### Task 1: Штрихкоды и QR — кодировщики, SVG, места печати; принятие ADR-0022

**Files:**
- Create:
  - `apps/web/src/shared/lib/barcode/`: `ean.ts`, `code128.ts`, `symbology.ts`, `qr.ts`, `index.ts`;
  - `apps/web/src/shared/ui/barcode/`: `BarcodeSvg.tsx`, `QrSvg.tsx`, `index.ts`;
  - `libs/ui/src/lib/print/LabelPrint.tsx`.
- Modify:
  - `package.json` и `package-lock.json` — `lean-qr` 2.7.4;
  - `libs/ui/src/lib/print/ReceiptPrint.tsx` — `after?: ReactNode` у `ReceiptPrint` и `ReceiptPreview`;
  - `libs/ui/src/index.ts`;
  - `libs/ui/src/styles/print.css` и `tokens/print.css`.
- Docs: ADR-0022 (статус), APPROVAL.md, CLAUDE.md, `docs/architecture/stack.md`.

**Interfaces:**
- Produces (`@/shared/lib/barcode`):

```ts
/** Bars and spaces from the left, in modules: true — a bar. */
export interface LinearBarcode {
  kind: 'ean13' | 'ean8' | 'code128';
  modules: boolean[];
  /** The text under the bars. */
  text: string;
}
/** The symbology of a product barcode on a tag (plan T2); null — no bars, print the code as text. */
export function tagBarcode(value: string, maxCode128: number): LinearBarcode | null;
/** QR modules of a text, correction level M: rows of the square matrix, true — dark. */
export function qrModules(text: string): boolean[][];
```

- Produces (`@/shared/ui/barcode`):
  - `<BarcodeSvg barcode={LinearBarcode} heightMm={number} />` — штрихи и текст под ними, ширина 100 %;
  - `<QrSvg text={string} sizeMm={number} />`.
- Produces (`@pharmacy/ui`):
  - `ReceiptPrint` и `ReceiptPreview` с `after?: ReactNode` — рисунок после строк;
  - `<LabelPrint size="58x40" | "40x30">{labels}</LabelPrint>` — каждый ребёнок печатается на своей странице;
  - `type LabelSize = '58x40' | '40x30'`.

- [ ] **Step 1: ADR-0022 → `accepted`.** Статус `accepted (<дата>, архитектор проекта — APPROVAL.md)`; строка APPROVAL.md
  с решениями T1–T12; CLAUDE.md и stack.md, «Фронтенд-библиотеки» — `lean-qr` и «свои: … штрихкоды ценников».
- [ ] **Step 2: Зависимость.** `npm install lean-qr@2.7.4 --save-exact`; в `package-lock.json` — только `lean-qr`.
- [ ] **Step 3: EAN.** `ean.ts`:
  - таблицы L, G, R и чётность первой цифры EAN-13 (стандарт GS1);
  - контрольная цифра: веса 3 и 1 справа, сумма до кратного 10;
  - EAN-13 — 95 модулей (101 · 6×L/G · 01010 · 6×R · 101), EAN-8 — 67 (101 · 4×L · 01010 · 4×R · 101);
  - текст под штрихами — все цифры.
- [ ] **Step 4: Code 128.** `code128.ts`:
  - таблица 107 образцов (103 символа, Start A/B/C, Stop), набор B;
  - контрольный символ — `(104 + Σ позиция × значение) mod 103`;
  - штрихи — по 11 модулей на символ, Stop — 13.
- [ ] **Step 5: Выбор символики и QR.**
  - `symbology.ts` — `tagBarcode(value, maxCode128)` по правилу T2: UPC-A — `ean13('0' + value)`; неверная контрольная
    цифра — Code 128;
  - `qr.ts` — `generate` из `lean-qr` с минимальной коррекцией M (`correction.M`), матрица `size × size` через `get(x, y)`;
    точные имена — по `index.d.ts` установленного пакета.
- [ ] **Step 6: SVG.**
  - `BarcodeSvg` — `<svg viewBox="0 0 (modules + 20) H">`: тихая зона по 10 модулей, `rect` на каждый непрерывный
    отрезок штриха, `shape-rendering="crispEdges"`, текст — HTML под SVG;
  - `QrSvg` — один `path` из квадратов, тихая зона 4 модуля, `crispEdges`, `role="img"`, `aria-label`.
- [ ] **Step 7: Места печати в `libs/ui`.**
  - `after` у `ReceiptPrint` (в корне печати после строк, по центру) и у `ReceiptPreview`;
  - `LabelPrint` — портал в `document.body`, как `SheetPrint`;
  - CSS:
    - `@page label-58x40 { size: 58mm 40mm; margin: 0 }`, `@page label-40x30 { size: 40mm 30mm; margin: 0 }`;
    - `.ph-print-labels[data-label-size='58x40'] { page: label-58x40 }` и для 40×30;
    - этикетка — `.ph-label` с размером страницы, внутренним полем `--ph-tag-padding`, `break-after: page`, у последней —
      `auto`;
  - токены: `--ph-tag-padding: 2mm`, `--ph-tag-bar-height-58: 12mm`, `--ph-tag-bar-height-40: 8mm`,
    `--ph-receipt-qr-size: 20mm`.
- [ ] **Step 8: Наборы.** `npx nx run-many -t lint test typecheck -p ui web`, `npx nx fsd web` → зелёные.
- [ ] **Step 9: Проверка декодером** (b1, b2).
  - В scratchpad: `npm install --prefix <scratch>/zxing @zxing/library@0.23.0`.
  - `tsc` проекта транспилирует `shared/lib/barcode` в ESM в scratchpad (без сборщика: `esbuild` в проекте нет).
  - Маленький статический сервер на `127.0.0.1` отдаёт страницу проверки, эти модули, `lean-qr` из `node_modules` проекта
    и `@zxing/library` из временной папки (import map).
  - Страница в in-app браузере рисует SVG, растеризует каждый рисунок в canvas ×4, затем `MultiFormatReader` его
    декодирует.
  - Expected b1: значения Review Focus 1 декодируются в себя (EAN-13, UPC-A как EAN-13 с `0`, EAN-8, Code 128); для
    кириллицы и 30 знаков `tagBarcode` вернул `null`; 13 цифр с неверной контрольной — Code 128.
  - Expected b2: QR трёх UUIDv7 декодируется в те же строки.
- [ ] **Step 10: Commit** `feat(web): barcodes and QR — own EAN and Code 128, lean-qr (ADR-0022)`.

### Task 2: Ценники — карточка товара и остатки

**Files:**
- Create: `apps/web/src/features/print-price-tags/` — `index.ts`, `model/tag.ts`, `ui/PriceTag.tsx`,
  `ui/PrintTagsDialog.tsx`.
- Modify:
  - `apps/web/src/pages/catalog/ui/ProductPage.tsx`;
  - `apps/web/src/pages/stock/ui/StockPage.tsx`;
  - i18n RU и TJ: `purchasing.json` — группа `products.card`, `stock.json` — `stock`, `stockDocs`; общие тексты окна —
    новая группа `priceTags` в `core.json`.

**Interfaces:**
- Consumes: `tagBarcode`, `BarcodeSvg` (задача 1), `LabelPrint`, `LabelSize`, `printDocument` (`@pharmacy/ui`).
- Produces:

```ts
export interface PriceTagData {
  name: string;
  /** «производитель · страна · уп. N шт.» or «уп. N шт.» */
  details: string;
  /** The first barcode of the product; null — none. */
  barcode: string | null;
  priceMinor: number;
}
```

  - `<PrintTagsDialog tags={PriceTagData[]} skipped={number} stores?={…} onClose />` — для одного товара с выбором точки
    или для набора из остатков.

- [ ] **Step 1: Тексты.** RU (TJ — из макета, где он есть, иначе по смыслу с отметкой для ревью):
  - «Печать ценника», «Печать ценников», «Точка», «Размер ценника», «58 × 40 мм», «40 × 30 мм», «Копий», «Печать»,
    «Закрыть»;
  - «Ценник печатается отдельно от чека: штрихкод, название и цена выбранной точки.»;
  - «Ценников к печати: {count}», «Без цены в точке — не напечатаны: {count}», «уп. {count} шт.»;
  - «Товар не продаётся ни в одной точке — ценник печатать нечего».

  Подсказки «появится после выбора библиотеки штрихкодов» (`products.card.tagPending`, `stockDocs.tagsPending`) удаляются.
- [ ] **Step 2: `PriceTag`** — разметка по T3 и T4: название (`line-clamp` 3), детали, `BarcodeSvg` или код текстом, цена
  `formatMoney`. Размер — классом по `LabelSize`; тот же компонент — в предпросмотре окна в масштабе 1:1 (мм).
- [ ] **Step 3: `PrintTagsDialog`** — по T6 и T7; печать — `LabelPrint` с `tags × copies` детьми и `printDocument()`.
- [ ] **Step 4: Карточка товара** (T6): кнопка «Печать ценника» активна при цене хотя бы в одной точке; данные — карточка и
  `prices.get`.
- [ ] **Step 5: Остатки** (T7): «Ценники» на панели выбора открывает окно с парами «точка × товар».
- [ ] **Step 6: Наборы.** `npx nx run-many -t lint test fsd -p web`, затем `npx nx build web` после обновления dist → зелёные.
  `package-lock.json`, если его изменила сборка, — `git checkout`.
- [ ] **Step 7: Живая проверка** (web 4210 + стенд):
  - p1 — карточка товара: окно с точками и ценами, предпросмотр как в макете, печать вызывает диалог (перехват
    `window.print`).
  - p2 — 3 товара × 2 копии из остатков: в корне печати 6 этикеток. Страница проверки печатает тот же HTML и CSS в PDF
    headless Chrome: 6 страниц 58 × 40 мм (`MediaBox` 164,4 × 113,4 pt), затем 40 × 30 мм (113,4 × 85,0 pt); пустой
    последней нет.
  - p3 — название в 120 знаков: цена видна, название обрезано на 3-й строке.
  - p4 — товар без цены в одной точке: «не напечатаны: 1»; товар без штрихкода — ценник без штрихов; товар с двумя
    штрихкодами — первый.
  - p5 — интерфейс TJ: название `nameTj`, тексты окна на TJ.
  - Штрихкоды ценников из p1 и p2 декодируются страницей проверки задачи 1.
- [ ] **Step 8: Commit** `feat(web): price tags — the product card and stock, 58 × 40 and 40 × 30 mm labels`.

### Task 3: QR на чеке и возврат по скану

**Files:**
- Modify:
  - `apps/web/src/features/pos/ui/SaleReceiptDialog.tsx` — `after={<QrSvg text={data.request.id} sizeMm={20} />}` у
    предпросмотра и печати;
  - i18n `pos.json` RU и TJ: `receiptNumber`, `receiptNumberHint` (T9).

**Interfaces:**
- Consumes: `QrSvg` (задача 1), `ReceiptPrint` / `ReceiptPreview` с `after` (задача 1).

- [ ] **Step 1: QR в окне чека** — по T8. У Z-отчёта (`ShiftPage`, `ShiftCardPage`) `after` не передаётся.
- [ ] **Step 2: Тексты возврата** — T9.
- [ ] **Step 3: Наборы.** `npx nx run-many -t lint test fsd -p web`, `npx nx build web` → зелёные.
- [ ] **Step 4: Живая проверка** (стенд, касса привязана на копии):
  - q1 — продажа: в предпросмотре и в корне печати есть QR; страница проверки декодирует его в `request.id` чека.
  - q2 — экран возврата: «скан» строки id (быстрые `keydown` по `event.code` и Enter) находит чек. Чек без связи (запись в
    буфер, как в истории смен) после досылки тоже находится.
  - q3 — Z-отчёт без QR.
- [ ] **Step 5: Commit** `feat(web): QR of the receipt id on the sale receipt; returns find a receipt by its QR`.

### Task 4: Документы QA, уборка стенда

**Files:**
- Modify:
  - `docs/qa/02-granitsy-pilota.md`;
  - `docs/superpowers/specs/2026-10-26-pilot-small-gaps-design.md` — отметка «QR на чеке — сделано планом
    2026-10-28-price-tags-qr (ADR-0022)»;
  - `apps/web/README.md` — строки о ценниках.

- [ ] **Step 1: «Границы пилота».**
  - Раздел 2: строки «Ценники и штрихкоды» и «QR-код на чеке» убрать.
  - Раздел 3, новый абзац «Ценники и QR»:
    - что на ценнике и откуда печатается;
    - размеры и настройка размера бумаги в драйвере принтера этикеток;
    - символика по значению штрихкода;
    - цена — упаковки;
    - QR id чека на чеке продажи; 1D-сканер QR не читает — номер вводят вручную;
    - читаемость проверить сканером точки на первой печати.
  - В шапке документа — дата состояния.
- [ ] **Step 2: Уборка стенда.** Копия БД, конфигурации, временная папка `zxing` и страница проверки, scratchpad, выход
  из сессий.
- [ ] **Step 3: Commit** `docs: pilot boundaries after price tags and the receipt QR`.
