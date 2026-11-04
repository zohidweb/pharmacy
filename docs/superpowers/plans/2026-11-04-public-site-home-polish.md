# Доводка главной сайта: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** выполнить правки H1–H7 спецификации. Главная становится короче, а первый экран, «Безопасность» и «Тарифы» —
понятнее владельцу аптеки.

**Architecture:** все правки внутри `apps/site/src/pages/home` (FSD, «pages first»), словарей сайта и
`site-theme.css`. Есть два исключения:
- один необязательный параметр `formatMoney` в `libs/shared/util`;
- заголовочная цена `/tariffs`.

Новых библиотек нет. Клиентские листы с `'use client'` — только там, где нужно состояние: калькулятор и окно снимка.

**Tech Stack:** Next.js 16 (SSR, standalone), React, Tailwind v4 на токенах `--ph-*`, `motion` 14.4.0 (только главная),
use-intl (ICU), Jest.

**Spec:** `docs/superpowers/specs/2026-11-04-public-site-home-polish-design.md`

## Global Constraints

- Только токены `--ph-*` и утилиты `@theme`, без произвольных значений Tailwind (`[...]`).
- Анимация — только `transform` и `opacity`. `motion` — только на главной.
- В словарях и разметке нет `—` и `–`. Тест `messages.spec.ts` это проверяет.
- Словари RU и TJ с одинаковыми ключами. Ключи, утилиты `@theme` и токены, которые больше никто не использует,
  удаляются.
- JS главной растёт не больше чем на 2 КБ gzip к main 73ac1b3b.
- Высота главной на 1440 px (RU) не больше 7 500 px.
- Контраст AA, axe без нарушений на главной и `/tariffs`.
- Шапки компонентов описывают новое поведение со ссылкой «spec 2026-11-04-public-site-home-polish, H…».
- Комментарии и идентификаторы — на английском, тексты интерфейса — в словарях.
- Новые и изменённые строки TJ пишет исполнитель. Он собирает их в список для проверки носителем языка в отчёте
  задачи.
- Коммиты — Conventional Commits, `--no-gpg-sign`, с trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Setup (до задачи 1)

1. Рабочая копия: `.claude/worktrees/public-site-home-polish`, ветка `feature/public-site-home-polish`.
2. `npm ci` в рабочей копии. Нельзя делать junction или symlink `node_modules` из основной копии.
3. Свежие декларации библиотек, иначе `next build` проверит типы по старым `libs/*/dist`:
   `npx nx run-many -t typecheck -p shared-dto shared-util shared-domain ui --skip-nx-cache`.
4. Опорные цифры «было» снимает контроллер один раз и записывает в ledger:
   - размер JS главной: сумма gzip чанков страницы `/` из сборки main;
   - высота страницы на 1440 px.

## Review Focus

1. **Цена 0.** Если цена точки в настройках биллинга равна 0, калькулятор не показывается, а цена выводится как
   сейчас. Иначе ползунок двигает «0 с».
2. **TJ, множественное число.** Правила `tg` — только `one` и `other`. ICU-строка без `other` ломает рендер на `/tg`.
3. **Без JS и при `reduce`.** Линия шагов полная, все шаги «пройдены». Калькулятор показывает суммы для 3 точек.
4. **Окно снимка.** После закрытия по Esc и по фону фокус возвращается на кнопку снимка. Tab не уходит за окно.
5. **Первый экран TJ на 1024 × 768.** Заголовок, обе кнопки и строка фактов видны без прокрутки.

---

### Task 1: деньги без нулевых дирамов (H6)

**Files:**
- Modify: `libs/shared/util/src/lib/money.ts`
- Test: `libs/shared/util/src/lib/money.spec.ts`

**Interfaces:**
- Produces: `formatMoney(amountMinor: number, options?: { withSign?: boolean; plainSpaces?: boolean; trimZeroDirams?: boolean }): string`.
  `trimZeroDirams` по умолчанию `false`, прежние вызовы не меняются.

- [ ] **Step 1: тест.** В `money.spec.ts` добавить `describe('formatMoney with trimZeroDirams')`:
  - `formatMoney(40000, { trimZeroDirams: true })` → `'400 с'`;
  - `41250` → `'412,50 с'`;
  - `120000` → тысячи с тем же разделителем групп, что у `formatMoney(120000)`, без `,00`. Сравнивать с
    `formatMoney(120000).replace(',00', '')`;
  - `0` → `'0 с'`;
  - `-40000` → `'-400 с'`;
  - `formatMoney(40000)` без параметра по-прежнему `'400,00 с'`.
- [ ] **Step 2.** `npx nx test shared-util` — новые тесты падают.
- [ ] **Step 3.** В `formatMoney` не выводить `,NN`, когда `trimZeroDirams && dirams === 0`.
- [ ] **Step 4.** `npx nx test shared-util` и `npx nx lint shared-util` — зелёные.
- [ ] **Step 5.** Коммит `feat(shared-util): format money without zero dirams on request`.

### Task 2: первый экран — один снимок и строка фактов (H1)

**Files:**
- Modify: `apps/site/src/pages/home/ui/sections/Hero.tsx`
- Modify: `apps/site/src/pages/home/ui/sections/HeroShots.tsx` (остаётся одним файлом с одним снимком)
- Modify: `apps/site/src/shared/i18n/messages/ru.json`, `tg.json`
- Delete: `apps/site/public/images/sales-report.webp`, если `grep -r sales-report apps/site` после правки пуст

**Interfaces:**
- Produces: `HeroShots({ alt }: { alt: string })` — один снимок кассы.
- Produces: ключи `home.hero.facts.browser`, `home.hero.facts.languages`, `home.hero.facts.billing`. Ключи
  `home.hero.shots.stock` и `home.hero.shots.report` удаляются. `home.hero.shots.pos` становится `home.hero.shot`.

- [ ] **Step 1: `HeroShots`.**
  - Один `pos.webp` (1600 × 1100), без `TILTS` и `straighten`, `Parallax` со `speed` не больше 0,1.
  - Остаются `site-enter`, `fetchPriority="high"` и свес на 64 px под панелью.
  - На 1024 px и шире снимок шире колонки и уходит за правый край панели. На 1440 × 900 его ширина не меньше 900 px,
    правый край обрезает `overflow-x-clip` панели.
  - На телефоне снимок целиком в ширину содержимого.
  - Утилиту ширины взять из `@theme`. Если нужной нет, добавить токен в `site-theme.css` рядом с `grid-cols-site-hero`
    и записать его в комментарий-список утилит.
- [ ] **Step 2: строка фактов.**
  - В `Hero.tsx` под кнопками — `<ul>` из трёх `<li>`: декоративная `Icon` (`aria-hidden`) и текст.
  - Иконки: `globe`, на выбор исполнителя для языков, `calendar-check`.
  - На телефоне столбик, с 640 px — строка с переносом.
  - Вход `site-enter site-enter-delay-4`, как у кнопок.
  - Тексты RU — дословно из спецификации, 4.1. TJ — перевод исполнителя.
- [ ] **Step 3.** Удалить ненужные ключи из обоих словарей. `sales-report.webp` удалить, если он нигде не используется.
- [ ] **Step 4: проверка.** `npx nx run-many -t test lint fsd -p site`, затем `npx nx build site --skip-nx-cache`.
  Живая проверка standalone-сборки на 1440 × 900 и 1024 × 768 (RU и TJ): первый экран вмещает заголовок, кнопки и
  факты; на 375 нет горизонтальной прокрутки.
- [ ] **Step 5.** Коммит `feat(site): one legible till screen and a facts row on the first screen`.

### Task 3: «Для кого» — сетка 2 × 2 (H2)

**Files:**
- Modify: `apps/site/src/pages/home/ui/sections/Audience.tsx`
- Modify: `apps/site/src/app/styles/site-theme.css` (удалить стопку)

**Interfaces:**
- Consumes: `RevealGroup`, `RevealItem` из `@/shared/ui/motion`.

- [ ] **Step 1: раскладка.** Заголовок слева без `sticky`, справа `<ul>` `grid gap-4 md:grid-cols-2`.
  - Карточки — `RevealItem as="li"`, заливки прежние (`PAINS`).
  - Внутри карточки: цифра сверху, заголовок и текст внизу (`mt-auto`).
  - Нет `md:min-h-site-stack-card` и `stackIndex`.
- [ ] **Step 2: `site-theme.css`.** Удалить `--ph-site-stack-step`, `--ph-site-stack-card-height`,
  `--ph-site-stack-index` и утилиты `top-site-stack`, `min-h-site-stack-card`, а также их упоминания в
  комментарии-списке. `top-site-sticky` остаётся: его использует `Faq.tsx`.
- [ ] **Step 3.** `grep -rn "site-stack" apps/site/src` пусто. `npx nx run-many -t test lint fsd -p site`, сборка.
  Живая проверка: на 1440 высота блока около 700 px, на 375 карточки идут столбиком.
- [ ] **Step 4.** Коммит `feat(site): audience pains as a 2x2 grid without pinning`.

### Task 4: «Как подключиться» — без закрепления (H3)

**Files:**
- Modify: `apps/site/src/pages/home/ui/sections/StepsProgress.tsx`
- Modify: `apps/site/src/pages/home/ui/sections/Steps.tsx`
- Modify: `apps/site/src/app/styles/site-theme.css` (удалить `--ph-site-steps-track` и `h-site-steps`)

**Interfaces:**
- Produces: `StepsProgress({ header, children })` — сигнатура прежняя. `data-step`, `data-step-marker` и `data-reached`
  остаются, `data-current` уходит.

- [ ] **Step 1: `StepsProgress`.**
  - Нет дорожки, `sticky`, `useScroll`, `useTransform`, `useMotionValueEvent` и порогов.
  - Обёртка — обычный блок `flex flex-col gap-12`. Отступы панели даёт `Steps.tsx` через `panelBodyClassName`.
  - Запуск, когда список виден на 40 %: `useInView(ref, { once: true, amount: 0.4 })` из `motion/react` или
    существующий механизм `Reveal`. Исполнитель выбирает и в отчёте называет вес до и после.
  - Линия: `scaleX` (с 1024 px) или `scaleY` (на телефоне) от 0 до 1 за 1,2 с, только `transform`.
  - Шаги: после запуска на каждый шаг ставится `data-reached` с задержкой `index × (1,2 с / 5)`. Можно через CSS
    `transition-delay` по индексу, без React-рендера на каждый шаг.
  - При `reduce` все шаги сразу `data-reached`, линия полная.
  - Без JS линия полная (`data-reveal`, как сейчас), шаги в цвете «пройден» по правилу `<noscript>` или CSS.
    Исполнитель проверяет это с выключенным JS.
- [ ] **Step 2: `Steps.tsx`.**
  - Убрать `group-data-current/step:text-accent-site` у заголовка.
  - К контейнеру добавить `panelBodyClassName`.
  - Шапку комментария переписать: нет закрепления, нет 92–206 px расчёта.
- [ ] **Step 3: `site-theme.css`.** Удалить `--ph-site-steps-track` и `h-site-steps`. Проверить, что
  `min-h-site-first-screen` по-прежнему используется (`Hero.tsx`).
- [ ] **Step 4: проверка.** Тесты, линт, `fsd`, сборка. Живая проверка на 1440 и 375:
  - линия заполняется один раз при входе;
  - при `reduce` (эмуляция в DevTools) и без JS всё полное;
  - высота блока около 650 px на 1440.
- [ ] **Step 5.** Коммит `feat(site): connection steps in a row that fill once, no pinned track`.

### Task 5: «Тарифы» — цена без копеек и калькулятор (H4)

**Files:**
- Create: `apps/site/src/pages/home/model/stores-total.ts`
- Test: `apps/site/src/pages/home/model/stores-total.spec.ts`
- Create: `apps/site/src/pages/home/ui/sections/PricingCalculator.tsx` (`'use client'`)
- Modify: `apps/site/src/pages/home/ui/sections/PricingTeaser.tsx`
- Modify: `apps/site/src/pages/tariffs/ui/TariffsPage.tsx` (только заголовочная цена)
- Modify: словари RU и TJ

**Interfaces:**
- Consumes: `formatMoney(..., { trimZeroDirams: true })` (задача 1), `vatOf(subtotalMinor, vatBp)` из
  `@pharmacy/shared-domain`.
- Produces:
  - `storesTotal(storePriceDirams: number, stores: number, vatBp: number): { totalDirams: number; withVatDirams: number }`;
  - `PricingCalculator({ storePriceDirams, vatBp, labels }: { storePriceDirams: number; vatBp: number; labels: { label: string; total: (amount: string, stores: number) => string; withVat: (amount: string) => string; note: string } })`.
    Тексты передаёт серверный `PricingTeaser` через `getTranslator`. Клиентский лист словарь не грузит.
  - Константы `CALCULATOR_STORES = { min: 1, max: 30, initial: 3 }` в `stores-total.ts`.

- [ ] **Step 1: тест `stores-total.spec.ts`.**
  - `storesTotal(40000, 3, 1400)` → `{ totalDirams: 120000, withVatDirams: 120000 + vatOf(120000, 1400) }`;
  - `storesTotal(41250, 1, 1400)` → `totalDirams` 41250;
  - `stores` вне 1–30 приводится к границе: 0 → 1, 31 → 30.
- [ ] **Step 2.** `npx nx test site` — падает.
- [ ] **Step 3: `storesTotal`.** Целые дирамы, без float.
- [ ] **Step 4: `PricingCalculator`.**
  - `<label>` + `<input type="range" min max step=1>`, крупное число рядом (`tabular-nums`).
  - Итог в `<p aria-live="polite">` — две строки и оговорка мелким текстом.
  - Цвет ползунка — `accent-color` через утилиту на токене. Контраст к зелёной панели не меньше 3 : 1.
  - Состояние — `useState` (дискретное значение, не непрерывный поток).
- [ ] **Step 5: `PricingTeaser`.**
  - Цена — `formatMoney(price, { trimZeroDirams: true })`.
  - Калькулятор под строкой НДС, только если `storeMonthlyPriceDirams > 0`.
  - `total` — ICU plural для RU (`one`, `few`, `many`, `other`) и TJ (`one`, `other`). Пример RU:
    `"{amount} в месяц за {stores, plural, one {# аптеку} few {# аптеки} many {# аптек} other {# аптеки}}"`.
- [ ] **Step 6: `TariffsPage`.** У заголовочной цены (`priceText`) — `trimZeroDirams: true`. Цены услуг и сумма с НДС в
  таблице без изменений.
- [ ] **Step 7: проверка.** `npx nx run-many -t test lint fsd -p site`, сборка. Живая проверка:
  - 1, 3 и 30 точек в RU и TJ — суммы и склонения верные;
  - клавиатура: стрелки, Home, End;
  - без JS — суммы для 3;
  - axe на главной и `/tariffs`.
- [ ] **Step 8.** Коммит `feat(site): price without zero dirams and a stores calculator`.

### Task 6: «Безопасность» — три пункта о пользе (H5)

**Files:**
- Modify: `apps/site/src/pages/home/ui/sections/Security.tsx`
- Modify: словари RU и TJ

- [ ] **Step 1: пункты.** `CLAIMS` — три пункта: `backups` (`refresh-cw`), `offsite` (`key-round`), `roles`
  (`user-check`).
  - Тексты RU заголовков, пояснений, `title` и `subtitle` — дословно из спецификации, 4.5.
  - Удалить `home.security.items.server` и `home.security.items.https` из обоих словарей.
  - Шапку комментария переписать: три пункта и то, на какие ADR опирается каждый.
- [ ] **Step 2: проверка.** Тесты, линт, сборка. Живая проверка на 1440 и 375.
- [ ] **Step 3.** Коммит `feat(site): security as three owner benefits`.

### Task 7: «Возможности» — увеличение снимка (H7)

**Files:**
- Create: `apps/site/src/pages/home/ui/sections/ShotZoom.tsx` (`'use client'`)
- Modify: `apps/site/src/pages/home/ui/sections/Features.tsx`
- Modify: словари RU и TJ

**Interfaces:**
- Produces: `ShotZoom({ src, width, height, alt, title, labels }: { src: string; width: number; height: number; alt: string; title: string; labels: { open: string; close: string } })`.
  Он оборачивает `<img>` плитки в кнопку и держит окно.
- Produces: ключи `home.features.zoom` (`"Увеличить снимок: {title}"`) и `home.features.close` (`"Закрыть"`).

- [ ] **Step 1: окно.** Сначала `Dialog` из `@pharmacy/ui` (`size="xl"`, `title` = заголовок плитки, `closeLabel`).
  - Если окно уже снимка или главная растёт больше чем на 1 КБ gzip от одного этого, взять нативный `<dialog>` с
    `showModal()`, Esc и щелчком по фону. Выбор и цифры — в отчёте.
  - Картинка в окне — `<img loading="lazy">` того же файла. Она монтируется только при открытии.
- [ ] **Step 2: плитка.**
  - Снимок — `<button type="button" aria-label={zoom}>` с `cursor-zoom-in` и декоративной иконкой `maximize` в круге в
    углу.
  - Подъём на 4 px при наведении остаётся.
  - Фокус после закрытия возвращается на кнопку.
- [ ] **Step 3: проверка.** Тесты, линт, `fsd`, сборка. Живая проверка:
  - мышь, Enter, Esc, щелчок по фону;
  - фокус;
  - axe;
  - вес JS главной к опорной цифре.
- [ ] **Step 4.** Коммит `feat(site): enlarge the product screens of the features`.

### Task 8: итоговая проверка

- [ ] **Step 1.** `npx nx run-many -t build test lint fsd -p site shared-util shared-domain`. Полный `npm run check`
  запускает пользователь.
- [ ] **Step 2: живая проверка standalone-сборки.**
  - Ширины 375, 1024 × 768, 1440 × 900, языки RU и TJ.
  - Высота главной на 1440 RU не больше 7 500 px.
  - Горизонтальной прокрутки нет.
  - axe на `/`, `/tg`, `/tariffs`.
  - LCP < 2,5 с, CLS < 0,1.
  - JS главной не больше опорной цифры + 2 КБ gzip.
- [ ] **Step 3: скриншоты «было — стало».** Снять пять блоков и показать пользователю.
- [ ] **Step 4: текст PR.**
  - Список строк TJ на проверку носителем.
  - Пункт чек-листа запуска: перед `APEX_MODE=site` проверить выгрузку копий в prod (`backup-status`), потому что
    сайт обещает копию вне сервера.
  - Цифры веса и высоты.

### Task 9: движение при прокрутке (H8, поправка 2026-11-04)

**Files:** `HeroShots.tsx`, `Audience.tsx`, `StepsProgress.tsx`, `Steps.tsx`, `Features.tsx`, `PricingCalculator.tsx`
(все в `apps/site/src/pages/home/ui/sections/`), `apps/site/src/shared/ui/motion/*` (новые клиентские листы при
необходимости), `site-theme.css` (если нужны правила `reduce` или без JS).

**Spec:** раздел 8 (H8.1–H8.5).

- [ ] **Step 1.** H8.1–H8.5 по таблице раздела 8.2. Каждое движение — отдельный коммит.
- [ ] **Step 2.** После каждого коммита `npx nx run-many -t test lint fsd -p site`. В конце
  `npx nx build site --skip-nx-cache` и живая проверка в трёх режимах (по умолчанию, `REDUCE=1`, `NOJS=1`):
  - высота;
  - отсутствие горизонтальной прокрутки на 375, 1024 и 1440;
  - JS ≤ 209,8 КБ gzip;
  - ошибки гидрации в консоли;
  - снимки блоков в середине прокрутки: движение видно;
  - снимки в конце прокрутки: всё в конечном положении.
- [ ] **Step 3.** axe на `/` и `/tg`.

### Task 10: раскладки без пустых колонок (H9, поправка 2026-11-04)

**Files:**
- секции: `Audience.tsx`, `Features.tsx`, `PricingTeaser.tsx`, `Security.tsx`, `Faq.tsx`;
- словари RU и TJ;
- `apps/site/public/images/sales-report.webp` (вернуть из `git show 8b7ebd7c:apps/site/public/images/sales-report.webp`);
- `site-theme.css`, если нужны новые утилиты.

**Spec:** раздел 9 (H9.1–H9.5).

- [ ] **Step 1.** H9.1–H9.5 по таблице раздела 9. Каждый блок — отдельный коммит.
- [ ] **Step 2.** После каждого коммита `npx nx run-many -t test lint fsd -p site`. В конце сборка и живая проверка:
  - на 375, 1024 и 1440, RU и TJ, режимы по умолчанию, `REDUCE=1` и `NOJS=1`;
  - высота и горизонтальная прокрутка;
  - JS;
  - axe на `/` и `/tg`;
  - снимки пяти блоков на 1440 сверены с макетом `gap-mock/after-*.png`.
