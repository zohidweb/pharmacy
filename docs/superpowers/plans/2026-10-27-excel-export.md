# Выгрузка в Excel: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** все неактивные сейчас кнопки «Excel» продукта работают и сохраняют файл `.xlsx`. Это отчёты владельца (все
девять, в том числе журнал ПКУ), журнал действий, остатки и статистика админки.

**Architecture:**
- Книгу пишет свой код в `@pharmacy/shared-util`: zip, CRC-32 и XML минимального пакета SpreadsheetML; сжатие — встроенный
  `CompressionStream('deflate-raw')`. Сохранение в файл — `@pharmacy/ui`.
- Файл строится в браузере из тех же ответов API, что и экран: с теми же правами и на языке интерфейса.
- Журнал действий и остатки выгружаются одним запросом до 20 000 строк. Больше 100 строк за запрос — только с правом
  выгрузки модуля.
- Отчёты, «Надо заказать» и статистика админки уже приходят на экран целиком: выгрузка берёт таблицу экрана.

**Tech Stack:** TypeScript, `CompressionStream`, `TextEncoder`, `Intl`, NestJS (class-validator), Next.js static export
(FSD), use-intl. Новых зависимостей нет.

**Spec:**
- ADR-0015, поправка 2026-10-20, п. 4: «Пересмотр — если понадобятся … запись `.xlsx`». Поправка 2026-10-27 — текст в
  задаче 1, шаг 5.
- Решения вне объёма, которые план закрывает:
  - `docs/superpowers/specs/2026-10-14-owner-cabinet-design.md`: E20 и раздел 9 — «Выгрузка отчётов в Excel и права
    `reports:export`, `audit:export`»;
  - `docs/superpowers/specs/2026-10-19-admin-dashboard-stats-design.md`: D15;
  - `docs/superpowers/specs/2026-10-21-pos-offline-limits-design.md`: раздел «Вне объёма» — «Выгрузка журнала ПКУ в Excel».
- `docs/qa/02-granitsy-pilota.md`: раздел 1 («Не входит: выгрузка в Excel») и раздел 2 (строка «Выгрузка в Excel»).
- Gap-анализ 2026-10-26 (память `gap-analysis-2026-10-26`): «CSV/Excel export of reports, ПКУ journal, audit log»,
  «statistics Excel disabled».
- ADR-0018: каталог прав, `<модуль>:export`.

## Решения автора (утверждение плана — утверждение поправки ADR-0015 2026-10-27)

| № | Вопрос | Решение |
|---|---|---|
| X1 | Формат и инструмент | Только `.xlsx`, своим кодом (поправка ADR-0015). CSV не предлагается: Excel превращает штрихкод в `4,6E+12`, русская Windows пишет cp1251, текст с `=` в начале исполняется как формула |
| X2 | Где код | Запись — `libs/shared/util/src/lib/xlsx/` (`crc32.ts`, `zip.ts`, `xlsx.ts`). Код чистый, без DOM: работает в браузере и в Node. Наружу — только из `xlsx.ts`. Сохранение файла — `libs/ui/src/lib/file/save-file.ts`: `saveFile`, `saveXlsx`. `saveBlob` загрузки данных заменяется на `saveFile` |
| X3 | Вид книги | Один лист. Строки сверху: название; период и фильтры; «Сформировано: …»; примечания, которые экран показывает под таблицей. Затем пустая строка и шапка: жирная, закреплена, с автофильтром. Затем данные и строка итога — жирная, вне автофильтра. Ширина колонки — по содержимому, от 8 до 60 знаков |
| X4 | Типы ячеек | Текст — встроенная строка, никогда не формула: штрихкоды, номера партий и документов остаются текстом. Деньги — число в сомони с двумя знаками (`#,##0.00`), из целых дирамов без деления с плавающей точкой. Целые — `#,##0`. Проценты — `0.0%`. Дата — `dd.mm.yyyy`. Дата и время — `dd.mm.yyyy hh:mm` в часовом поясе приложения (`APP_TIME_ZONE`). Штуки — числом, к шапке добавляется «, шт.»; упаковки — числом, «, уп.». Нет значения — пустая ячейка |
| X5 | Защита содержимого | Символы, недопустимые в XML 1.0, удаляются (одиночные суррогаты тоже). Текст ячейки — не длиннее 32 767 знаков. Имя листа — до 31 знака, без `[]:*?/\` и апострофа по краям. Имя файла — без `\/:*?"<>|` и управляющих символов, до 150 знаков |
| X6 | Откуда данные | Из тех же ответов API, что у экрана, с теми же правами: себестоимости без `finance:view-cost` нет ни на экране, ни в файле. Язык — интерфейса. Сервер файлов не формирует |
| X7 | Большие списки | Журнал действий и остатки — один запрос с `limit` = `EXPORT_ROW_LIMIT` (20 000, `@pharmacy/shared-util`) и таймаутом 60 с. API принимает `limit` до 20 000. Больше 100 — только с `audit:export` (журнал) или `inventory:export` (остатки), иначе 403 `forbidden`. Если по фильтру строк больше 20 000 (`total`), файла нет — сообщение просит сузить фильтр |
| X8 | Права и кнопки | Кнопка видна только с правом: отчёты — `reports:export`, журнал — `audit:export`, остатки — `inventory:export`. В шаблонах они уже есть: заведующий — `reports:export` и `inventory:export`; бухгалтер и владелец — все три. Для таблиц, которые экран уже получил (отчёты, «Надо заказать»), право работает только в интерфейсе: те же данные видны на экране. Админка — кто видит «Статистику» (`platform:view`) |
| X9 | Где выгрузка | **Отчёты:** «Excel» в шапке, отчёт на экране (все 9 видов). **Журнал действий:** «Экспорт в Excel» с текущими фильтрами. **Остатки:** «Excel» в шапке — список с текущими фильтрами, сортировкой и точкой, а в режиме «Надо заказать» — этот список; «Выгрузить в Excel» на панели выбранных строк — выбранные строки страницы. **Статистика админки:** «Выгрузить в Excel». Подсказки «появится после выбора библиотеки» уходят. «Ценники» остаются неактивными с подсказкой «Печать ценников появится после выбора библиотеки штрихкодов (ADR).» |
| X10 | Колонки | **Отчёт:** колонки ответа с шапками экрана. `money` → деньги; `count` → целое; `percent` → процент; `quantity` → целое «, уп.»; `pieces` → целое «, шт.»; `date`, `datetime` — дата и время; `reason` и `text` — текст экрана, «Итого» и «данные рецепта удалены» тоже. **Журнал:** время; дата документа (если задним числом); сотрудник; точка или «Сеть»; действие; объект; подробности; источник («Оператор» или пусто). **Остатки:** товар; штрихкод; точка; ПКУ («ПКУ» или пусто); партия; годен до; остаток, шт.; штук в упаковке; минимум, шт.; себестоимость упаковки (с правом); цена упаковки; состояние. **«Надо заказать»:** товар; точка; остаток, шт.; минимум, шт.; не хватает, шт.; штук в упаковке. **Статистика:** компания; точка (пусто в строке компании); режим; чеков; продажи; средний чек; последняя активность. Показатели (KPI) и «данные на» — строками сверху |
| X11 | Имя файла | `xlsxFileName(название, период, точка)`, например «Продажи по точкам 01.10.2026–27.10.2026.xlsx» или «Остатки Аптека 1.xlsx». Даты — `dd.mm.yyyy` |
| X12 | Журнал и ПДн | Запись «выгрузил» в журнал действий не пишется: сервер не знает, сохранён ли файл, а сами данные видны на экране с теми же правами. В файле журнала ПКУ есть данные рецептов. Срок их хранения в системе (поправка ADR-0015 2026-10-21) на файл не действует — за файл отвечает сеть; это строка в «Границах пилота» |
| X13 | Документы | Поправка ADR-0015 2026-10-27; строка в APPROVAL.md; CLAUDE.md, «Фронтенд-библиотеки» — «чтение xlsx/csv, запись xlsx». «Границы пилота»: Excel уходит из разделов 1 и 2, поведение — в раздел 3. `apps/web/README.md` — строки об Excel. Примечания «сделано планом 2026-10-27-excel-export» у E20 и раздела 9 спецификации кабинета владельца, у D15 спецификации админки и у раздела «Вне объёма» спецификации кассы 2026-10-21 |
| X14 | Вне плана | CSV. Выгрузка каталога, документов и закупок (права `catalog:export` и `purchasing:export` есть, кнопок в макетах нет). Шаблоны загрузки в `.xlsx`. Несколько листов, диаграммы, выгрузка на сервере. Печать ценников (ADR о штрихкодах) |

## Global Constraints

- **Тесты.** Отложены до MVP, проверка живая; существующие наборы остаются зелёными. Модуль `xlsx` (CRC, zip, XML,
  экранирование) — первый кандидат на unit-тесты после MVP: строка в описании PR. Временный spec задачи 1 —
  инструмент проверки, в git не попадает.
- **Без зависимостей.** Только встроенное: `CompressionStream`, `TextEncoder`, `Intl`, `Blob`. Целевые браузеры
  (Chrome/Edge, две последние версии) и Node 22/24 знают `deflate-raw`.
- **Деньги.** Целые дирамы. Сомони в ячейке — строка из целой и дробной части, без `/ 100`.
- **Сборка.** `next build` проверяет типы по `libs/*/dist`. После правок `shared-util` и `ui` выполнить
  `npx nx run-many -t typecheck -p shared-util ui shared-dto --skip-nx-cache`: кэш Nx уже отдавал старый dist.
- **Стенд проверки** — копия dev-БД `pharmacy_export_check`, как в истории смен:
  - копия — `pg_dump | pg_restore` суперпользователем контейнера; права сохраняются;
  - обёртка в scratchpad подменяет имя БД в URL из `.env` и `.env` не печатает; режимы `migrate`, `script`, `api`;
  - API — `apps/api/dist/main.js` (перед запуском `npx nx build api`), конфигурация `api-export-check` на 3000: env как у
    `api-oc-4210` без `STEP_UP_MAX_AGE_SECONDS`, плюс `ADMIN_ORIGIN=http://127.0.0.1:4310`;
  - web — `web-partial-4210` (`http://127.0.0.1:4210`); админка — новая конфигурация `admin-partial-4310`:
    `npx next dev apps/admin -p 4310`, `NEXT_PUBLIC_API_MOCKS=partial`.

  Сотрудники синтетической сети получают пароль новым кодом активации на копии: владелец, заведующий, кассир и роль без
  себестоимости. Оператор — `create-operator.mjs` и экран «Первый вход». После проверки удалить копию, обе конфигурации
  и scratchpad.
- **Файлы из браузера.**
  - Перехват: `javascript_tool` подменяет `URL.createObjectURL` и сохраняет `Blob` в `window.__export`, затем кнопка, затем
    base64 этого `Blob`, затем файл в scratchpad.
  - Проверка в scratchpad:
    - `python -I` с `openpyxl` — строгий разбор XML;
    - Excel через COM (`Excel.Application`, только чтение, `DisplayAlerts = false`) — `Value2` и `Text` ячеек.
- **Общая среда.** Redis общий с dev: сессии — только синтетических сотрудников. Порты 4200/4201 не использовать.
- **Оформление.**
  - Prettier — только для файлов, отформатированных на HEAD.
  - Коммиты — `--no-gpg-sign`, Conventional Commits, в конце `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Регулярные выражения с `\` — через Edit, не через heredoc.
  - Тексты TJ — с отметкой для ревью TJ.

## Review Focus

1. **Имена с `&`, `<`, кавычками, эмодзи, таджикскими буквами, управляющим символом; имя, начинающееся с `=`, `+`, `-`,
   `@`.** Ожидается: Excel открывает файл без восстановления, текст тот же (управляющий символ удалён), ничего не
   вычисляется. Проверка — задача 1 (s1), задача 3 (w5).
2. **Штрихкод `0460123456789`, партия `000123`, суммы 1 дирам и −12,30 с.** Ожидается: штрихкод и партия — текст с нулями
   впереди; деньги — 0,01 и −12,30; сумма колонки денег в Excel равна итогу отчёта. Проверка — задача 1 (s1), задача 3
   (w1, w5).
3. **Журнал за период, где 20 000 записей и 20 001.** Ожидается: 20 000 — файл одним запросом в пределах таймаута;
   20 001 — сообщение, ни файла, ни части файла. Проверка — задача 2 (a3), задача 3 (w3).
4. **Права.** Ожидается:
   - у заведующего без `audit:export` нет кнопки журнала, API на `limit=101` отвечает 403;
   - у кассира на `/stock?limit=101` — 403;
   - у роли без `finance:view-cost` в файле остатков нет себестоимости.

   Проверка — задача 2 (a2), задача 3 (w4).
5. **Время около полуночи по Душанбе.** Ожидается: запись 19:30Z — в файле 00:30 следующего дня, как на экране; срок
   годности не сдвигается на день. Проверка — задача 1 (s1), задача 3 (w2).

---

### Task 1: Запись `.xlsx`, сохранение файла, поправка ADR-0015

**Files:**
- Create: `libs/shared/util/src/lib/xlsx/crc32.ts`, `zip.ts`, `xlsx.ts`; `libs/ui/src/lib/file/save-file.ts`.
- Modify:
  - `libs/shared/util/src/index.ts` — `export * from './lib/xlsx/xlsx';`;
  - `libs/ui/src/index.ts` — `saveFile`, `saveXlsx`;
  - `apps/web/src/features/data-import/model/csv-out.ts` — без `saveBlob`; `ui/CheckStep.tsx`, `ui/FileStep.tsx` берут
    `saveFile` из `@pharmacy/ui`.
- Docs: `docs/architecture/adr/0015-*.md` (поправка), `docs/architecture/APPROVAL.md`, `CLAUDE.md` (строка
  «Фронтенд-библиотеки»).

**Interfaces:**
- Produces (`@pharmacy/shared-util`):

```ts
export const EXPORT_ROW_LIMIT = 20_000;
export const XLSX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export type XlsxCell =
  | null
  | { kind: 'text'; value: string }
  | { kind: 'integer'; value: number }
  | { kind: 'money'; minor: number }
  /** 12.5 → 12,5 % */
  | { kind: 'percent'; value: number }
  /** YYYY-MM-DD */
  | { kind: 'date'; value: string }
  /** an ISO instant, shown in APP_TIME_ZONE */
  | { kind: 'dateTime'; value: string };

/** Cell builders; null and undefined give an empty cell. */
export const xlsxCell: {
  text(value: string | null | undefined): XlsxCell;
  integer(value: number | null | undefined): XlsxCell;
  money(minor: number | null | undefined): XlsxCell;
  percent(value: number | null | undefined): XlsxCell;
  date(value: string | null | undefined): XlsxCell;
  dateTime(value: string | null | undefined): XlsxCell;
};

export interface XlsxSheet {
  name: string;
  /** Lines above the table; the first one bold. */
  heading: readonly string[];
  columns: readonly string[];
  rows: readonly (readonly XlsxCell[])[];
  /** The total row, bold, outside the auto filter. */
  total?: readonly XlsxCell[];
}

export function xlsxBytes(sheet: XlsxSheet): Promise<Uint8Array>;
export function xlsxFileName(...parts: readonly (string | null | undefined)[]): string;
```

- Produces (`@pharmacy/ui`): `saveFile(blob: Blob, fileName: string): void`;
  `saveXlsx(sheet: XlsxSheet, fileName: string): Promise<void>`.
- Internal: `crc32(data: Uint8Array): number`; `zipFiles(files: readonly { name: string; data: Uint8Array }[]): Promise<Uint8Array>`.

- [ ] **Step 1: `crc32.ts`, `zip.ts`.**
  - CRC-32: табличный, полином `0xEDB88320`, начальное и конечное `0xFFFFFFFF`.
  - Zip:
    - на каждый файл — локальный заголовок `0x04034b50`: версия 20, флаги 0, метод 8, время 0, дата `0x0021`
      (1980-01-01), CRC и размеры известны до записи, без data descriptor; затем сжатые данные
      (`CompressionStream('deflate-raw')`);
    - затем центральный каталог (`0x02014b50`, версия «создано» 20) и конец каталога `0x06054b50`;
    - имена ASCII; размер больше `0xFFFFFFFF` — `RangeError` (zip64 нет).
- [ ] **Step 2: `xlsx.ts`.** Части пакета:
  - `[Content_Types].xml`: Default `rels` и `xml`; Override `/xl/workbook.xml` (`…spreadsheetml.sheet.main+xml`),
    `/xl/worksheets/sheet1.xml` (`…worksheet+xml`), `/xl/styles.xml` (`…styles+xml`);
  - `_rels/.rels` — `officeDocument` → `xl/workbook.xml`;
  - `xl/_rels/workbook.xml.rels` — `rId1` worksheet `worksheets/sheet1.xml`, `rId2` styles `styles.xml`;
  - `xl/workbook.xml` — один `sheet` (`sheetId="1"`, `r:id="rId1"`) и `definedName` `_xlnm._FilterDatabase`
    (`localSheetId="0"`, `hidden="1"`) на диапазон автофильтра: `'имя'!$A$h:$X$n`, апостроф в имени удваивается;
  - `xl/styles.xml`:
    - `numFmts`: 164 `0.0%`, 165 `dd.mm.yyyy`, 166 `dd.mm.yyyy hh:mm`;
    - шрифты: Calibri 11 и Calibri 11 жирный; две заливки (`none`, `gray125`); одна граница;
    - `cellXfs` по индексу: 0 — обычный; 1 — жирный; 2 — `#,##0` (`numFmtId` 3); 3 — `#,##0.00` (`numFmtId` 4);
      4 — 164; 5 — 165; 6 — 166; 7 — 2 жирный; 8 — 3 жирный; 9 — 4 жирный;
  - `xl/worksheets/sheet1.xml`, элементы в порядке схемы:
    - `sheetViews` с `pane` `state="frozen"` под шапкой;
    - `sheetFormatPr`;
    - `cols` (`customWidth="1"`);
    - `sheetData`: у каждой ячейки `r="B7"`; текст — `t="inlineStr"` и `<is><t xml:space="preserve">`; число — `<v>`;
    - `autoFilter` — от шапки до последней строки данных.

  Значения:
  - деньги — `${sign}${целые}.${две цифры}` из целого `minor`;
  - дата — `Date.UTC(y, m − 1, d) / 86 400 000 + 25 569`;
  - дата и время — части стенного времени `APP_TIME_ZONE` (`Intl.DateTimeFormat` `formatToParts`, `hourCycle: 'h23'`),
    затем та же формула с часами, минутами и секундами;
  - процент — `value / 100`;
  - нечисловое значение (`NaN`, `Infinity`) — пустая ячейка.

  Недопустимые символы XML удаляются выражением
  `/[^\u0009\u000A\u000D -퟿-�\u{10000}-\u{10FFFF}]/gu`, затем экранируются `& < > "`. Если строк
  больше 1 048 576 с учётом заголовка — `RangeError`.

  Ширина колонки — `clamp(длина + 2, 8, 60)`. Длина считается по шапке и по виду значения: текст — первые 200 знаков;
  дата — 10; дата и время — 16; деньги и целые — цифры плюс разделители.
- [ ] **Step 3: `save-file.ts`** — `saveFile`: ссылка с `download`, `URL.createObjectURL`, `click`, отзыв URL на следующем
  тике; `saveXlsx` = `xlsxBytes` + `Blob` с `XLSX_MIME_TYPE` + `saveFile`. Загрузка данных переходит на `saveFile`.
- [ ] **Step 4: Проверка файлом.**
  - Временный `libs/shared/util/src/lib/xlsx/scratch.spec.ts` (не коммитится) пишет в scratchpad три файла:
    - s1 — все виды ячеек и строки из Review Focus 1, 2, 5 (в том числе `2026-10-27T19:30:00Z` и срок `2026-10-28`),
      итог, заголовок из трёх строк;
    - s2 — 20 000 строк × 8 колонок, время сборки печатается;
    - s3 — без строк данных.

    Запуск: `npx jest -c libs/shared/util/jest.config.cts libs/shared/util/src/lib/xlsx/scratch.spec.ts`.
  - Expected:
    - `openpyxl` открывает все три;
    - Excel открывает все три без окна восстановления;
    - в s1:
      - `Value2` денег — `0.01`, `-12.3`, `1234.56`;
      - штрихкод — строка `0460123456789`;
      - `=1+1` — строка, `HasFormula = False`;
      - время — `28.10.2026 00:30` (`Text`), дата — `28.10.2026`;
      - процент — `0.125`;
      - шапка закреплена, автофильтр на шапке;
    - s2 собирается в Node меньше чем за 3 с, `UsedRange.Rows.Count` = 20 000 + строки сверху.

    Spec удалить.
- [ ] **Step 5: Документы.**
  - Поправка в ADR-0015 — после поправки 2026-10-23, текст ниже дословно;
  - строка APPROVAL.md: дата 2026-10-27; что — «ADR-0015, поправка 2026-10-27 „Выгрузка в Excel“ и план
    `2026-10-27-excel-export.md` (решения X1–X14)» с кратким пересказом пп. 1–4; `APPROVED`; «Утверждено архитектором
    2026-10-27 вместе с планом»;
  - CLAUDE.md, строка «Фронтенд-библиотеки»: «чтение xlsx/csv, запись xlsx».

```markdown
## Поправка 2026-10-27 (выгрузка в Excel)

Утверждена архитектором 2026-10-27 вместе с планом `docs/superpowers/plans/2026-10-27-excel-export.md` (решения X1–X14;
APPROVAL.md). Это пересмотр по триггеру поправки 2026-10-20 («запись `.xlsx`»). Остальное решение ADR не меняется.

1. **Свои реализации дополняются записью `.xlsx`.** Книгу с одним листом пишет свой код в `libs/shared/util`
   (`src/lib/xlsx`): без библиотек и без DOM, одна реализация для web и админки.
   - Пакет SpreadsheetML минимального состава: типы содержимого, связи, книга, стили, лист. Строки встроенные (`inlineStr`),
     общей таблицы строк нет.
   - Zip пишет свой код: локальные заголовки, центральный каталог, без zip64. Сжатие — `CompressionStream('deflate-raw')`,
     контрольная сумма — свой табличный CRC-32 (полином `0xEDB88320`). CRC-32 — проверка целостности архива, не
     криптография: правило ADR-0011 о самописной криптографии не затрагивается.
   - Ячейки: текст, целое, деньги (сомони с двумя знаками, из целых дирамов без деления с плавающей точкой), процент,
     дата, дата и время в часовом поясе приложения. Текст — всегда строка, не формула.

   Отвергнутые варианты — те же, что для чтения:
   - SheetJS: `xlsx` 0.18.5 на npm с известными уязвимостями;
   - ExcelJS: тяжёлая, серверные зависимости, нет выпусков с 2023 года;
   - `write-excel-file`: та же цепочка поставок, что у `read-excel-file`;
   - CSV: штрихкод превращается в `4,6E+12`, кодировка cp1251, текст с `=` в начале исполняется как формула.
2. **Файл строится в браузере** из тех же ответов API, что и экран: с теми же правами (поля себестоимости без
   `finance:view-cost` отсутствуют) и на языке интерфейса. Тексты журнала действий собирает клиент (спецификация
   2026-10-14-owner-cabinet, E7). Сервер файлов не формирует и не хранит.
3. **Один запрос на выгрузку.** `GET /api/v1/audit-log` и `GET /api/v1/stock` принимают `limit` до 20 000
   (`EXPORT_ROW_LIMIT`, `@pharmacy/shared-util`). Больше 100 — только с правом выгрузки модуля (`audit:export`,
   `inventory:export`), иначе 403. Если по фильтру строк больше 20 000, файл не формируется и экран просит сузить фильтр.
   Отчёты, «Надо заказать» и статистика админки приходят таблицей целиком.
4. **Права выгрузки** каталога ADR-0018 (`reports:export`, `audit:export`, `inventory:export`) показывают кнопку. Для
   данных, которые экран уже получил, право работает только в интерфейсе: те же данные видны на экране.
5. **Последствия:**
   - около 300 строк своего кода сопровождает команда;
   - выгрузка в журнал действий не пишется;
   - в файле журнала ПКУ есть данные рецептов. Срок их хранения в системе (поправка 2026-10-21) на файл не действует —
     за файл отвечает сеть.

   Пересмотр — если понадобятся несколько листов, диаграммы, выгрузка больше 20 000 строк (на сервере) или CSV.
```

- [ ] **Step 6: Наборы.**
  - Команды:
    - `npx nx run-many -t lint test -p shared-util ui web`;
    - `npx nx run-many -t typecheck -p shared-util ui shared-dto --skip-nx-cache`.
  - Expected: всё зелёное.
- [ ] **Step 7: Commit** `feat(shared): own .xlsx writer and file saving (ADR-0015 amendment 2026-10-27)`.

### Task 2: API — выгрузка журнала действий и остатков одним запросом

**Files:**
- Modify:
  - `apps/api/src/common/pagination.ts` — `export const MAX_PAGE_LIMIT = 100;`;
  - `apps/api/src/app/audit/dto/audit-journal.dto.ts` — `@Max(EXPORT_ROW_LIMIT)`;
  - `apps/api/src/app/audit/audit-journal.ts` — проверка права;
  - `apps/api/src/app/inventory/dto/stock.dto.ts` — у запроса списка `@Max(EXPORT_ROW_LIMIT)`; второй `@Max(500)` не
    трогать;
  - `apps/api/src/app/inventory/stock.service.ts` — проверка права;
  - `libs/shared/dto/src/lib/tenant-staff.ts` (`AuditQuery.limit`) и запрос списка остатков в
    `tenant-inventory.ts` — комментарий: «≤ 100; up to `EXPORT_ROW_LIMIT` with `audit:export` / `inventory:export` (the
    Excel export, ADR-0015 amendment 2026-10-27)».

**Interfaces:**
- Consumes: `EXPORT_ROW_LIMIT` из `@pharmacy/shared-util` (задача 1).
- Produces:
  - `GET /api/v1/audit-log?limit≤20000` — при `limit > MAX_PAGE_LIMIT` без `audit:export` — 403 `forbidden`;
  - `GET /api/v1/stock?limit≤20000` — при `limit > MAX_PAGE_LIMIT` без `inventory:export` — 403 `forbidden`.

- [ ] **Step 1: Проверки.** Проверка — в начале `AuditJournal.list` и `StockService.list`, до транзакции:
  `hasPermissions(principal.permissions, 'audit:export')` (соответственно `'inventory:export'`). Код ответа — как у
  `PermissionsGuard` (`ProblemException(403, 'forbidden')`). Обработчики моков web не меняются: они отдают любую страницу.
- [ ] **Step 2: Сборка.** `npx nx run-many -t lint test typecheck -p api shared-dto`, `npx nx build api` → зелёные.
- [ ] **Step 3: Живая проверка** (стенд `api-export-check`, curl с телами в UTF-8 из файлов):
  - a1 — владелец: `GET /audit-log?limit=20000` → 200, `items.length = min(total, 20000)`; `GET /stock?limit=20000` → 200.
  - a2 — права:
    - заведующий: `/audit-log?limit=101` → 403 `forbidden`, `limit=100` → 200, `/stock?limit=101` → 200;
    - кассир: `/stock?limit=101` → 403.
  - a3 — объём. Добавить синтетические записи в `audit_log` копии: 20 500 копий существующей записи `receipt.completed`
    сети, новые `id`, `recorded_at` — по 10 дням. Затем `GET /audit-log?from=…&to=…&limit=20000` → 200, `total` = 20 500
    и больше. Записать время ответа и размер тела. Expected: меньше 5 с (`statement_timeout`), иначе — ruling с
    понижением предела.
  - a4 — `limit=20001` → 400 `validation_failed`.
- [ ] **Step 4: Commit** `feat(api): one-request export of the audit log and stock — limit up to 20 000 with the export permission`.

### Task 3: Web — отчёты, журнал действий, остатки

**Files:**
- Create:
  - `apps/web/src/pages/owner/reports/lib/report-sheet.ts`;
  - `apps/web/src/pages/owner/audit-log/lib/audit-sheet.ts`;
  - `apps/web/src/pages/stock/lib/stock-sheet.ts`.
- Modify:
  - `ReportsPage.tsx`, `AuditLogPage.tsx`, `StockPage.tsx`;
  - i18n RU и TJ: `core.json` — новая группа `export`; `owner.json` — без `reports.excelPending` и
    `auditLog.excelPending`; `stock.json` — `stockDocs.soonHint` → `stockDocs.tagsPending`.

**Interfaces:**
- Consumes: `xlsxCell`, `xlsxFileName`, `EXPORT_ROW_LIMIT`, `XlsxSheet` (`@pharmacy/shared-util`); `saveXlsx`
  (`@pharmacy/ui`); `limit` до 20 000 (задача 2).
- Produces:
  - `reportSheet(table: ReportTable, texts: ReportSheetTexts): XlsxSheet`, где `ReportSheetTexts` = `{ name; heading;
    header(column); cell(column, value, row): string | null; total }`. `cell` — текст экрана для типов `text`, `reason` и
    для удалённого рецепта;
  - `auditSheet(entries: readonly TenantAuditEntry[], texts: AuditSheetTexts): XlsxSheet` — `texts.entry` =
    `useAuditEntryText()`;
  - `stockSheet(rows: readonly StockRow[], texts, options: { canSeeCost: boolean })`;
  - `reorderSheet(lines: readonly ReorderLine[], texts)`.

- [ ] **Step 1: Тексты `core.json` → `export`** (RU дословно; TJ — по смыслу, с отметкой для ревью):
  - `period`: «Период: {from} — {to}»;
  - `madeAt`: «Сформировано: {at}»;
  - `store`: «Точка: {name}»;
  - `allStores`: «Все точки»;
  - `employee`: «Сотрудник: {name}»;
  - `action`: «Действие: {name}»;
  - `search`: «Поиск: «{q}»»;
  - `state`: «Состояние: {name}»;
  - `selected`: «Выбранные строки: {count}»;
  - `pieces`: «{header}, шт.»;
  - `packs`: «{header}, уп.»;
  - `perPack`: «Штук в упаковке»;
  - `controlled`: «ПКУ»;
  - `tooManyAudit`: «Записей больше {limit} — файл не сформирован. Сузьте период или выберите точку, сотрудника или
    действие.»;
  - `tooManyStock`: «Строк больше {limit} — файл не сформирован. Выберите точку, состояние или найдите товар.»;
  - `failed`: «Не удалось сформировать файл. Повторите попытку.»

  `stockDocs.tagsPending`: «Печать ценников появится после выбора библиотеки штрихкодов (ADR).» Пустое поле периода
  в строке `period` — «…».
- [ ] **Step 2: Отчёты.**
  - Кнопка «Excel»:
    - с `reports:export`, активна, когда отчёт загружен и период верный, иначе её нет;
    - на клик — `saveXlsx(reportSheet(report.data, …), xlsxFileName(название, период, точка))`.
  - Строки сверху: название; «Период … · Точка …»; «Сформировано …»; примечания, которые экран показывает под таблицей
    для этого вида (`costHidden`, `debtsToday`, `networkExpensesInTotal`, `controlledHint`).
  - Итог — `data.total`.
  - Ошибка — `Alert tone="warning"` с `export.failed` на месте прежней подсказки.
- [ ] **Step 3: Журнал действий.**
  - Кнопка — с `audit:export`, `loading` на время выгрузки.
  - На клик:
    - `apiRequest('auditLog.list', { query: { …фильтры экрана, limit: EXPORT_ROW_LIMIT, offset: 0 }, timeoutMs: 60_000 })`;
    - `total > EXPORT_ROW_LIMIT` — `Alert` `export.tooManyAudit`, файла нет;
    - иначе `auditSheet` и `saveXlsx`.
  - Строки сверху: название; период и непустые фильтры (точка, сотрудник, действие, поиск); «Сформировано».
  - Ошибка API — `useApiErrorMessage` в том же `Alert`; он очищается при следующем клике.
- [ ] **Step 4: Остатки.**
  - «Excel» в шапке — с `inventory:export`:
    - в обычном режиме — `stock.list` с фильтрами, сортировкой и точкой экрана, `limit: EXPORT_ROW_LIMIT`,
      `timeoutMs: 60_000`; при `total > EXPORT_ROW_LIMIT` — `export.tooManyStock`;
    - в режиме «Надо заказать» — `reorderSheet(reorderList.data)` без запроса.
  - «Выгрузить в Excel» на панели выбора — с `inventory:export`: выбранные строки страницы, строка сверху
    `export.selected`.
  - «Ценники» — неактивна, `title` и строка панели — `tagsPending`.
  - Колонки — X10. Состояние — тем же текстом, что `StockStatePill`.
- [ ] **Step 5: Наборы.**
  - Команды: `npx nx run-many -t lint test fsd -p web`; затем `npx nx build web` после обновления dist (Global
    Constraints).
  - Expected: зелёные; `package-lock.json`, если сборка его изменила, вернуть `git checkout -- package-lock.json`.
- [ ] **Step 6: Живая проверка** (web 4210 + `api-export-check`, файлы — перехватом, проверка — `openpyxl` и Excel):
  - w1 — владелец, все 9 отчётов:
    - файлы открываются, шапки с единицами;
    - деньги — числа, итог в файле равен итогу экрана, сумма колонки денег в Excel равна итогу;
    - журнал ПКУ: у продажи с удалённым рецептом — текст экрана.
  - w2 — журнал:
    - фильтры по точке и действию попадают в строки сверху;
    - запись около полуночи — то же время, что на экране; запись оператора — «Оператор».
  - w3 — журнал за период с синтетическими записями задачи 2:
    - больше 20 000 — сообщение и ни файла, ни части;
    - сузить до 20 000 и меньше — файл; записать время от клика до сохранения.
  - w4 — права:
    - заведующий: кнопки «Excel» у отчётов и остатков есть, у журнала нет;
    - роль на копии с `reports:*`, `inventory:view`, `inventory:export`, но без `finance:view-cost`: в файле остатков нет
      себестоимости.
  - w5 — остатки:
    - товар на копии со штрихкодом `0460123456789`, именем `=Тест & <Ҳ>` и партией `000123`: в файле — текст, нули
      на месте;
    - «Надо заказать» и выбранные строки выгружаются;
    - «Ценники» неактивны с новой подсказкой.
- [ ] **Step 7: Commit** `feat(web): Excel export of reports, the audit log and stock`.

### Task 4: Админка — статистика; документы

**Files:**
- Create: `apps/admin/src/pages/statistics/lib/stats-sheet.ts`.
- Modify:
  - `apps/admin/src/pages/statistics/ui/StatisticsPage.tsx`;
  - `apps/admin/src/shared/i18n/messages/ru.json` и `tg.json` (`statistics`: без `exportPending`, новые строки);
  - документы:
    - `docs/qa/02-granitsy-pilota.md`;
    - `apps/web/README.md` (строки 70, 90, 103 об Excel: загрузка уже сделана, выгрузка теперь тоже);
    - примечания в спецификациях (X13).

**Interfaces:**
- Consumes: `xlsxCell`, `xlsxFileName` (`@pharmacy/shared-util`), `saveXlsx` (`@pharmacy/ui`).
- Produces: `statsSheet(data: UsageStatsResponse, texts): XlsxSheet` (тип ответа — тот, что у `usage.stats`).

- [ ] **Step 1: Статистика.**
  - Кнопка «Выгрузить в Excel» активна, когда данные загружены (`variant` прежний).
  - Строки сверху:
    - «Статистика — {период}»;
    - «Компания: {имя}» или «Все компании»;
    - «Данные на {asOf}»;
    - показатели: «Чеков за период …; объём продаж …; средний чек …; кассиров …»;
    - `note` экрана;
    - «Сформировано».
  - Колонки — X10: строка компании, затем её точки. Режим — тем же текстом, что `StoreModePill`.
  - Ошибка — `Alert`.
  - RU-строки: `exportHeading` «Статистика — {period}»; `exportScope` «Компания: {name}»; `exportAsOf` «Данные на {at}»;
    `exportKpi` «Чеков за период: {receipts}; объём продаж: {sales}; средний чек: {average}; кассиров: {cashiers}»;
    `exportMadeAt` «Сформировано: {at}»; `exportFailed` «Не удалось сформировать файл. Повторите попытку.»; колонки —
    `columns.tenant` «Компания», `columns.store` «Точка».
- [ ] **Step 2: Наборы.** `npx nx run-many -t lint test fsd -p admin`, `npx nx build admin` → зелёные.
- [ ] **Step 3: Живая проверка** (админка 4310 + `api-export-check`; оператор создаётся на копии):
  - файл за текущий месяц — все компании и одна компания;
  - продажи — числа; суммы по точкам компании равны строке компании.
- [ ] **Step 4: «Границы пилота».**
  - Раздел 1: из «Не входит» убрать «Выгрузка в Excel (отчёты, журнал, статистика)».
  - Раздел 2:
    - строку «Выгрузка в Excel» убрать;
    - в строке «Ценники и штрихкоды» — новый текст подсказки.
  - Раздел 3, новый абзац «Выгрузка в Excel»:
    - где кнопки и чьи права;
    - журнал и остатки — не больше 20 000 строк, иначе сообщение;
    - деньги — числами в сомони; штрихкоды — текстом; время — по Душанбе;
    - файл журнала ПКУ содержит данные рецептов, и срок хранения рецептов в системе на него не действует;
    - выгрузка в журнал действий не пишется.
  - Строка «Состояние» в шапке документа — дата и «после выгрузки в Excel».
- [ ] **Step 5: Уборка стенда.** Удалить копию `pharmacy_export_check`, конфигурации `api-export-check` и
  `admin-partial-4310` (`.claude/launch.json`), scratchpad. Выйти из сессий браузера.
- [ ] **Step 6: Commit** `feat(admin): Excel export of the usage statistics; docs: pilot boundaries after the Excel export`.
