# Сайт: светлая страница и цветные панели — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** сайт `apps/site` становится светлым, с крупными скруглёнными цветными панелями, шириной содержимого 1320 px
и своей раскладкой у каждого блока главной. Анимация, тексты, данные, SEO и форма заявки работают как раньше.

**Architecture:**
- **Тема.** Корень `<html data-theme="site">` светлый. Цветные панели — контейнеры с атрибутом
  `data-surface="dark|green|mint"`. Атрибут переопределяет семантические `--ph-color-*` и токены сайта на самом
  контейнере, поэтому кнопки, ссылки и поля кита внутри панели берут её цвета без правок кита.
- **Раскладка.** Общие классы ширины и панели лежат в `shared/ui/page.ts`. Секции главной переразмечаются по одной.
- **Движение.** Новое только одно: наклон экранов первого экрана в существующем `Parallax`. Стопка карточек «Для
  кого» — CSS `sticky`.

**Tech Stack:** Next.js 16 (App Router, ISR), React 19, `motion` 14.4.0 (`motion/react`, только главная), Tailwind v4
на `--ph-*`, `@pharmacy/ui`, use-intl, Playwright и `@axe-core/playwright` для живых проверок.

**Spec:** `docs/superpowers/specs/2026-11-02-public-site-light-panels-design.md` (дальше — «дополнение»). Он дополняет
`docs/superpowers/specs/2026-11-02-public-site-redesign-design.md` и предыдущий план
`docs/superpowers/plans/2026-11-02-public-site-redesign.md`. Где они расходятся, действует дополнение.

## Global Constraints

- **Цвета** — только в `apps/site/src/app/styles/site-theme.css`, по таблицам 4.1 дополнения:
  - новые примитивы: `--ph-mint-0 #FBFEFC`, `--ph-mint-25 #F2FAF6`, `--ph-mint-150 #CFE3DA`,
    `--ph-emerald-ink-600 #3E5C55`;
  - прежние примитивы не меняются: `--ph-emerald-975/950/900/800/700`, `--ph-mint-50/200/300/400`;
  - чистых `#000` и `#fff` нет.
- **Корень (светлый):**
  - bg — mint-25, surface — mint-0, sunken — mint-50;
  - fg — emerald-975, muted — ink-600;
  - primary — emerald-700, текст кнопки — mint-25, hover — emerald-800;
  - focus ring — emerald-700, граница полей — ink-600, линии — mint-150;
  - ошибка (danger) — значения кита для светлой темы, не переопределяются;
  - `color-scheme: light`.
- **Панели:**

  | Панель | Фон | Текст | Вторичный | Кнопка | Текст кнопки |
  |---|---|---|---|---|---|
  | `dark` | emerald-950 | mint-50 | mint-300 | mint-400 | 975 |
  | `green` | emerald-700 | mint-50 | mint-50 | mint-400 | 975 |
  | `mint` | mint-400 | 975 | 975 | emerald-950 | mint-50 |

  У `dark` остальные токены — нынешнее тёмное сопоставление без изменений (фон панели — 950).
- **Ширина:** содержимое — 1320 px (`--ph-site-content-width: 82.5rem`), поля 16 px на телефоне и 32 px от 1024 px.
  Колонка чтения `48ch` не меняется.
- **Панели:**
  - отступ от краёв окна — 8 px на телефоне, 16 px от 1024 px;
  - радиус — 32 px (`--ph-site-radius-panel`);
  - внутренние отступы по вертикали — 48 и 96 px;
  - соседние блоки разделены отступом 16 и 24 px, линий между секциями нет.
- **Радиусы:** плитки и карточки — 24, кнопки — полностью скруглённые, поля — 12, панели — 32. Других нет.
- **Экраны продукта:** на светлом фоне — рамка 1 px mint-150 и тень `0 24px 64px rgb(4 33 27 / 0.18)`. На тёмной
  панели — прежняя тень `rgb(1 20 16 / 0.5)`, без рамки. Других теней нет.
- **Размеры (дополнение 4.4):**
  - бегущая строка — 40 px (28 px на телефоне), Bold;
  - цифры «Для кого» — 64 px, Bold;
  - цифры шагов и цена — 96 px (56 px на телефоне), Bold, у цены `tabular-nums`;
  - строки «Безопасности» — 24 px, Medium;
  - заголовок финального призыва — 56 px от 1024 px.
- **Без произвольных значений** в классах (`[...]`): только утилиты `@theme` сайта и кита. `md:` — это 1024 px.
- **Движение:**
  - анимируются только `transform` и `opacity`;
  - `motion` — только на главной, внутри `MotionScope`;
  - шапка и остальные страницы — только CSS;
  - при `prefers-reduced-motion: reduce` нет наклона, стопки, закрепления и бегущей строки, всё видно сразу.
- **Бюджет JS:** JS главной вырастает не больше чем на 3 КБ gzip к 9d4b99f. Там было 207,6 КБ (gzip -9, тот же
  способ замера), значит предел — 210,6 КБ.
- **Тексты:**
  - словари не меняются: новых строк нет, `—` и `–` нет;
  - кнопка везде «Оставить заявку»;
  - про 1С и офлайн-точки не упоминать.
- **Кит `libs/ui` не меняется.** Новых зависимостей нет.
- **Тесты отложены до MVP.** Новых тестов нет, существующие остаются зелёными. Проверка по задаче:
  `npx nx run-many -t lint test build fsd -p site` — PASS. Полный `npm run check` запускает человек.
- **Живые проверки:**
  - production-сборка и standalone-сервер `node apps/site/.next/standalone/apps/site/server.js` на `127.0.0.1:4410`;
  - API ворктри на `127.0.0.1:3010`;
  - `next dev` здесь зацикливается в Chrome, его не использовать;
  - порт 3000 не трогать.

## Решения плана

| № | Решение |
|---|---|
| L1 | Блок `[data-surface='dark'], [data-surface='green'], [data-surface='mint']` ставит своим `--ph-color-*` значения панели. Ещё он ставит `background-color: var(--ph-color-bg)` и `color: var(--ph-color-fg)`: фон панели — это её `--ph-color-bg`, поэтому «цвет страницы внутри» (маркеры шагов на `bg-bg`) совпадает с панелью |
| L2 | Токены кита, которые собраны из семантических на `:root` (`--ph-input-bg`, `--ph-input-border`, `--ph-input-border-focus`, `--ph-input-border-invalid`, `--ph-input-ring-focus`), в каждой панели объявляются заново теми же выражениями. Иначе поле в панели взяло бы цвета корня: свойство с `var()` вычисляется там, где объявлено |
| L3 | Токены сайта, которые зависят от поверхности, тоже объявляются в корне и в каждой панели: `--ph-site-accent` (утилита `text-accent-site`/`bg-accent-site`), `--ph-site-line` (`border-site-line`, `divide-site-line`, `bg-site-line`), `--ph-site-shot-border` (`border-site-shot`), `--ph-site-shadow-shot` (`shadow-shot`). Значения акцента: корень — emerald-700, `dark` — mint-400, `green` — mint-50, `mint` — 975. Линии: корень — mint-150, `dark` и `green` — emerald-800, `mint` — emerald-700 (линии только декоративные). Рамка экрана: корень — mint-150, панели — `transparent` |
| L4 | Утилиты `bg-site-canvas` и `bg-site-block` и правило `.bg-site-block` удаляются. Фон страницы — `bg-bg`, цветной блок — `data-surface`. Новые утилиты: `max-w-site-content`, `rounded-site-panel`, `top-site-stack`, `min-h-site-stack-card`, `text-site-marquee(-sm)`, `text-site-number`, `text-site-figure(-sm)`, `bg-site-mint` (mint-400, маркеры строки), `text-site-step-future` (mint-300 с прозрачностью через `color-mix`, декоративный) |
| L5 | Общие классы в `shared/ui/page.ts`: `contentClassName = 'mx-auto w-full max-w-site-content px-4 md:px-8'`, `panelClassName = 'mx-2 rounded-site-panel md:mx-4'` и `panelBodyClassName = 'py-12 md:py-24'` (внутренние отступы). Светлые секции главной используют те же вертикальные отступы. `pageClassName` строится на `contentClassName` |
| L6 | Ритм главной: `<main className="flex flex-col gap-4 md:gap-6">`. `MotionScope` своего элемента не рисует, секции — прямые дети `main`. Подвал — панель с `mt-4 mb-2 md:mt-6 md:mb-4` |
| L7 | Наклон экранов первого экрана — новый необязательный проп `tilt?: number` (градусы) у `Parallax`. Это свой `useScroll({ target: ref, offset: ['start start', 'center start'] })` → `useTransform(progress, [0, 1], [tilt, 0])` → `style.rotate`. Он работает только при `wide && !reduce`, иначе 0. Постоянные классы `-rotate-3`/`rotate-2` у экранов удаляются. Наклон: склад −6°, отчёт −4°, касса −2° |
| L8 | Стопка «Для кого»: `li` с `md:motion-safe:sticky md:motion-safe:top-site-stack md:min-h-site-stack-card`. Индекс карточки передаётся в `style` как `--ph-site-stack-index` (по образцу `--ph-site-enter-index` шапки). `top-site-stack = calc(var(--ph-site-sticky-top) + var(--ph-site-stack-index, 0) * var(--ph-space-4))`, высота карточки — `20rem` |
| L9 | Список «что входит в цену» на панели тарифов главной **не делается**. Три коротких подходящих строки в словаре нет: `tariffs.store.billing` повторяет `home.pricing.vat`, остальные строки — длинные предложения. Так велит дополнение 4.4 п. 7: «если подходящих строк нет — без списка» |
| L10 | «Безопасность»: утверждение — заголовок строки 24 px Medium, пояснение остаётся под ним вторичным текстом. Текст не теряется, новых строк нет |
| L11 | Шаги: в `li` сначала маркер на линии, потом большой номер `01`–`05` (`aria-hidden`), потом заголовок и текст. Так линия остаётся на своей высоте `top-2`. Номер по умолчанию `text-site-step-future`, у пройденных и текущего — `group-data-reached/step:text-accent-site` |
| L12 | Firefox для проверки стопки: если браузер Playwright `firefox` не установлен, не скачивать. Записать в отчёт и попросить человека проверить вручную |

## Review Focus

1. **Фокус в панелях.** Переход по Tab по ссылкам и кнопкам в зелёной панели (тарифы), мятной (призыв) и тёмной
   (подвал) показывает кольцо фокуса с контрастом ≥ 3:1 к фону панели. Проверяет задача 6: вычисленный цвет
   `outline`/`box-shadow` против фона панели.
2. **Цена 56 px на 375 px, обе локали.** `whitespace-nowrap` у цены не создаёт горизонтальную прокрутку на `/` и
   `/tg`. Если цена не помещается, на телефоне берётся `text-display-sm`. Задачи 4 и 6.
3. **Стопка под шапкой 72 px.** Закреплённая карточка не уходит под шапку: верх первой карточки ≥ низа шапки.
   При `reduce` и на телефоне — обычный список. Задачи 3 и 6.
4. **Выступ первого экрана на 1024–1100 px.** Экраны не перекрывают бегущую строку и не дают горизонтальной прокрутки.
   Задачи 2 и 6: проверка на 1024 и 1440.
5. **Поле в панели.** Если поле кита окажется в панели, его граница и кольцо фокуса берут цвета панели (L2). Сейчас
   полей в панелях нет. Задача 1 объявляет токены, задача 6 проверяет форму `/connect` на светлом фоне: граница
   поля ≥ 3:1, кольцо фокуса видно.

---

### Task 1: Тема, ширина и каркас страниц

**Files:**
- Modify: `apps/site/src/app/styles/site-theme.css` — примитивы, светлый корень, три панели (L1–L3), токены и утилиты
  (L4), новая таблица контрастов в шапке файла.
- Modify: `apps/site/src/shared/ui/page.ts`, `apps/site/src/shared/ui/index.ts` — L5.
- Modify: `apps/site/src/app/layouts/SiteLayout.tsx`, `apps/site/app/global-error.tsx` — `bg-site-canvas` → `bg-bg`,
  комментарии «dark emerald» → светлая тема.
- Modify: `apps/site/src/widgets/site-header/ui/SiteHeader.tsx` — ширина `contentClassName`. Фон после прокрутки —
  `bg-surface/90` и линия `border-site-line`. Меню на телефоне — `bg-bg`.
- Modify: `apps/site/src/widgets/site-footer/ui/SiteFooter.tsx` — тёмная панель (L6), ширина `contentClassName`.
- Modify: `apps/site/src/pages/home/ui/sections/PricingTeaser.tsx`, `CallToAction.tsx`,
  `apps/site/src/pages/blog/ui/BlogPage.tsx` — временно: `bg-site-block` → `data-surface="green"`, чтобы сборка
  оставалась зелёной (раскладку меняют задачи 4 и 5).
- Modify: все `max-w-(--ph-size-dialog-xl) … px-4` в `apps/site/src` → `contentClassName` (или его классы). Секции
  главной, которые переразметят задачи 2–4, можно пока перевести одной заменой.

**Interfaces:**
- Produces:
  - `data-surface="dark" | "green" | "mint"` на любом контейнере;
  - `contentClassName`, `panelClassName`, `panelBodyClassName` из `@/shared/ui`;
  - утилиты L3 и L4: `text-accent-site`, `bg-accent-site`, `border-site-line`, `border-site-shot`, `shadow-shot`,
    `max-w-site-content`, `rounded-site-panel`, `top-site-stack`, `min-h-site-stack-card`, `text-site-marquee`,
    `text-site-marquee-sm`, `text-site-number`, `text-site-figure`, `text-site-figure-sm`, `bg-site-mint`,
    `text-site-step-future`.

- [ ] **Step 1:** переписать `site-theme.css` по Global Constraints и L1–L4:
  - примитивы;
  - `:root[data-theme='site']` светлый: только роли из таблицы 4.1, плюс форма (`--ph-button-radius` и т. п.) и
    `--ph-input-ring-focus`;
  - блок панелей с общими правилами L1 и тремя наборами значений;
  - `color-scheme`: `dark` у `dark` и `green`, `light` у `mint`;
  - `@theme inline` с утилитами.
  Таблица контрастов в шапке файла — по фактическим hex, на каждое состояние:
  - fg и muted на фоне и на поверхности;
  - текст кнопки на кнопке;
  - кольцо фокуса и граница поля на фоне.
- [ ] **Step 2:** `page.ts` по L5. Перевести на него `pageClassName`, шапку, подвал и все секции с
  `--ph-size-dialog-xl`. Затем `grep -rn "dialog-xl\|site-canvas\|site-block" apps/site` → пусто.
- [ ] **Step 3:** `npx nx run-many -t lint test build fsd -p site` → PASS.
- [ ] **Step 4:** собрать и перезапустить сервер на 4410. Короткая проверка Playwright из scratchpad на `/` и
  `/tariffs` при 1440 и 375:
  - фон `body` — `rgb(242, 250, 246)`;
  - шапка и содержимое шириной 1320 px при 1440;
  - подвал — панель с отступом 16 px от краёв;
  - горизонтальной прокрутки нет;
  - axe без нарушений `color-contrast`.
- [ ] **Step 5:** коммит `feat(site): light theme with colour panels and a 1320 px content width`.

### Task 2: Главная — первый экран и бегущая строка

**Files:**
- Modify: `apps/site/src/pages/home/ui/HomePage.tsx` — ритм L6.
- Modify: `apps/site/src/pages/home/ui/sections/Hero.tsx`:
  - секция — тёмная панель (`panelClassName`, `data-surface="dark"`), `overflow-x-clip` с видимым низом;
  - от 1024 px — `md:mb-16`, место под выступ.
- Modify: `apps/site/src/pages/home/ui/sections/HeroShots.tsx`:
  - рамка экранов выходит за низ панели примерно на 64 px (сдвиг `md:translate-y-16` или отрицательный нижний
    отступ — на выбор исполнителя);
  - уходит `md:-mr-12`;
  - наклон L7;
  - экраны в тёмной панели — без рамки, с прежней тенью (L3).
- Modify: `apps/site/src/shared/ui/motion/Parallax.tsx` — проп `tilt` по L7.
- Modify: `apps/site/src/pages/home/ui/sections/CapabilityMarquee.tsx`, `MarqueeFrame.tsx`:
  - строка без линий `border-y`;
  - текст `text-site-marquee-sm md:text-site-marquee`, Bold, `text-accent-site` (emerald-700);
  - маркеры `bg-site-mint`;
  - кнопка паузы остаётся.

**Interfaces:**
- Consumes: задача 1 (`panelClassName`, `data-surface`, утилиты).
- Produces: `ParallaxProps.tilt?: number` — градусы в начале прохода, 0 к центру элемента у верха окна.

- [ ] **Step 1:** `Parallax` с `tilt` (L7). Существующий сдвиг `y` не меняется.
- [ ] **Step 2:** Hero, HeroShots, бегущая строка, ритм `main`.
- [ ] **Step 3:** `npx nx run-many -t lint test build fsd -p site` → PASS.
- [ ] **Step 4:** живая проверка (4410, Playwright):
  - при 1440×900 и `scrollY 0` поворот экрана склада −6° ± 0,5°;
  - после прокрутки к центру экрана у верха окна — 0° ± 0,5°;
  - при `reducedMotion: 'reduce'` и на 375 — 0°;
  - при 1024 и 1440 низ любого экрана ≤ верха строки (Review Focus 4);
  - горизонтальной прокрутки нет на 375, 1024 и 1440;
  - LCP первого экрана < 2,5 с.
- [ ] **Step 5:** коммит `feat(site): hero on a dark panel with overhanging screens, large marquee`.

### Task 3: Главная — «Для кого» и возможности

**Files:**
- Modify: `apps/site/src/pages/home/ui/sections/Audience.tsx` — стопка L8:
  - закреплённый заголовок слева;
  - четыре карточки: поверхность с `border-site-line`, `mint`, поверхность, `dark`;
  - номер `01`–`04` `text-site-number` Bold (`aria-hidden`) вместо иконки;
  - заголовок и текст как сейчас;
  - `Reveal` у карточек остаётся.
- Modify: `apps/site/src/pages/home/ui/sections/Features.tsx`:
  - те же шесть плиток и сетка;
  - `raised` удаляется;
  - плитка `pricing` — `data-surface="mint"`, плитка `reports` — `data-surface="dark"` (без рамки), остальные —
    поверхность с `border-site-line`;
  - экраны: без маски `mask-b-*`, прижаты к правому нижнему углу и обрезаны краем плитки, `border border-site-shot
    shadow-shot`;
  - подъём при наведении прежний.

**Interfaces:**
- Consumes: задача 1 (`top-site-stack`, `min-h-site-stack-card`, `text-site-number`, `border-site-shot`,
  `data-surface`).

- [ ] **Step 1:** Audience по L8 и списку выше.
- [ ] **Step 2:** Features по списку выше.
- [ ] **Step 3:** `npx nx run-many -t lint test build fsd -p site` → PASS.
- [ ] **Step 4:** живая проверка (Chrome, 1440×900):
  - при прокрутке через секцию верх карточки N закрепляется на `верх карточки 1 + 16·(N−1)` px ± 1;
  - верх первой карточки ≥ низа шапки (Review Focus 3);
  - при `reduce` и на 375 у карточек `position: static`;
  - сетка возможностей без пустых ячеек при 1440 (у всех 6 плиток есть площадь, в сетке нет дыр);
  - axe без нарушений.
- [ ] **Step 5:** коммит `feat(site): stacked audience cards, colour tiles with cropped screens`.

### Task 4: Главная — шаги, тарифы, безопасность, вопросы, призыв

**Files:**
- Modify: `apps/site/src/pages/home/ui/sections/Steps.tsx` — тёмная панель вокруг `StepsProgress`, номера по L11
  (`text-site-figure-sm md:text-site-figure`). `StepsProgress.tsx` меняется, только если раскладка в панели этого
  требует. Закрепление и линия прежние.
- Modify: `PricingTeaser.tsx`:
  - зелёная панель `panelClassName` + `panelBodyClassName`;
  - заголовок слева;
  - справа цена `text-site-figure-sm md:text-site-figure tabular-nums whitespace-nowrap`, «за точку в месяц», строка
    НДС, ссылка на `/tariffs`;
  - списка нет (L9).
- Modify: `Security.tsx` — по L10:
  - строки с линиями `divide-y divide-site-line`;
  - иконка в круге `bg-surface-sunken` (mint-50);
  - заголовок строки `text-2xl font-medium`;
  - `RevealGroup` прежний.
- Modify: `Faq.tsx`:
  - сетка `grid-cols-site-aside` с закреплённым заголовком `md:motion-safe:sticky md:motion-safe:top-site-sticky`;
  - каждый `<details>` — карточка `rounded-site-card bg-surface border border-site-line`, промежутки между
    карточками вместо линий;
  - раскрытие прежнее.
- Modify: `CallToAction.tsx` — мятная панель, заголовок `text-display-sm md:text-display`, кнопка `primary` (в `mint`
  она тёмная), `Reveal` прежний.

**Interfaces:**
- Consumes: задача 1 (`panelClassName`, `panelBodyClassName`, `text-site-figure(-sm)`, `text-site-step-future`,
  `data-surface`).

- [ ] **Step 1:** Steps и PricingTeaser.
- [ ] **Step 2:** Security, Faq, CallToAction.
- [ ] **Step 3:** `npx nx run-many -t lint test build fsd -p site` → PASS.
- [ ] **Step 4:** живая проверка:
  - номера шагов: у текущего — `rgb(93, 202, 165)` (mint-400), у будущих цвет другой;
  - при `reduce` все номера mint-400;
  - цена без горизонтальной прокрутки на 375 в `/` и `/tg` (Review Focus 2);
  - кнопка призыва — фон `rgb(6, 48, 42)`, текст `rgb(236, 247, 242)`;
  - axe без нарушений.
- [ ] **Step 5:** коммит `feat(site): dark steps with large numbers, green pricing, manifesto, faq cards, mint call`.

### Task 5: Остальные страницы

**Files:**
- Modify: `apps/site/src/pages/tariffs/ui/TariffsPage.tsx`:
  - блок цены — зелёная панель `rounded-site-panel` в ширине содержимого, крупная цена без НДС (решение 28 редизайна);
  - правило оплаты и услуги — плитки поверхности с `border-site-line`;
  - призыв — мятная панель.
- Modify: `apps/site/src/pages/blog/ui/BlogPage.tsx` — карточки поверхности, без обложки — `data-surface="mint"`.
- Modify: `apps/site/src/pages/article/ui/ArticlePage.tsx` — обложка `border border-site-shot shadow-shot`.
- Modify: `apps/site/src/pages/connect/ui/ConnectPage.tsx`, `apps/site/src/features/connection-request/ui/ConnectionRequestForm.tsx`:
  - форма — `bg-surface border border-site-line` вместо `bg-surface-highlight`;
  - блок «что будет после заявки» — тёмная панель `rounded-site-panel p-6 md:p-10`.
- Check: `apps/site/src/shared/ui/state-screen.ts`, `apps/site/app/[locale]/not-found.tsx`, `apps/site/app/[locale]/error.tsx`, `apps/site/app/global-error.tsx` — цифра
  `text-accent-site` на светлом фоне (emerald-700). Правка — только если цвет другой.

**Interfaces:**
- Consumes: задача 1.

- [ ] **Step 1:** тарифы и блог.
- [ ] **Step 2:** статья, заявка, страницы состояний.
- [ ] **Step 3:** `npx nx run-many -t lint test build fsd -p site` → PASS.
- [ ] **Step 4:** живая проверка `/tariffs`, `/blog`, статья, `/connect`, `/offer`, `/privacy`, `/no-such-page` при
  1440 и 375:
  - axe без нарушений;
  - горизонтальной прокрутки нет;
  - на `/connect` граница поля ≥ 3:1 к поверхности, кольцо фокуса видно (Review Focus 5);
  - отправка формы с пустыми полями показывает ошибки, как раньше.
- [ ] **Step 5:** коммит `feat(site): light tariffs, blog, article, connect and state pages`.

### Task 6: Проверка готовности и текст PR

**Files:**
- Modify: `.superpowers/pr-public-site-redesign.md` (вне git) — раздел о светлой теме, обновлённые цифры, отступления.
- Scratch: скрипт Playwright в scratchpad (как R10 предыдущего плана), не в репозитории.

- [ ] **Step 1:** production-сборка, перезапуск сервера 4410. Скрипт по страницам `/`, `/tg`, `/tariffs`, `/blog`,
  статья, `/offer`, `/privacy`, `/connect`, 404, при 1440 и 375, без ограничения сети и на Fast 4G с CPU ×4:
  - axe — 0 нарушений;
  - горизонтальной прокрутки нет;
  - LCP < 2500 мс;
  - CLS < 0,1, кроме `/offer`;
  - при 1440 ширина содержимого 1320 px, панели в 16 px от краёв.
- [ ] **Step 2:** проверки дополнения 6 и Review Focus 1–5:
  - кольцо фокуса в панелях ≥ 3:1;
  - стопка в Chrome и Firefox (L12);
  - `reducedMotion: 'reduce'`: всё видно, наклона и закрепления нет;
  - режим без JS: всё видно;
  - на страницах, кроме главной, нет чанка `motion`.
- [ ] **Step 3:** бюджет JS главной: gzip -9 всех JS-файлов, которые грузит `/`. Результат ≤ 210,6 КБ. Если больше —
  записать отступление в текст PR.
- [ ] **Step 4:** обновить текст PR:
  - что изменилось: светлая тема, панели, ширина, раскладки;
  - цифры проверки;
  - отступления: L9, L10 и всё, что найдено при проверке.
- [ ] **Step 5:** коммит изменений, если проверка их вызвала: `fix(site): …`.
