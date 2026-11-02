# Редизайн публичного сайта «Смелый цветной»: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** сайт `apps/site` выглядит как премиальный продукт: одна тёмно-изумрудная тема, крупная типографика,
настоящие экраны продукта и осмысленная анимация. Данные, SEO и форма заявки работают как раньше.

**Architecture:**
- **Тема.** Сайт получает свою тему: примитивы `--ph-emerald-*` и `--ph-mint-*` и переопределение семантических
  `--ph-color-*` на `<html data-theme="site">`. Кит `libs/ui` не меняется, его кнопки и поля перекрашиваются через
  токены.
- **Анимация.** Движение — библиотека `motion` 14.4.0 (ADR-0024), в общем слое `shared/ui/motion` из клиентских
  «листьев». Вход первого экрана — CSS-анимация: она не ждёт гидратации и не задерживает LCP.
- **Главная** собирается заново из 11 секций спецификации 4.5. Остальные страницы получают ту же тему.

**Tech Stack:** Next.js 16 (App Router, ISR), React 19, `motion` 14.4.0 (`motion/react`), Tailwind v4 на `--ph-*`,
`@pharmacy/ui`, use-intl, Playwright (снимки экранов и проверки, уже в devDependencies), `@axe-core/playwright`.

**Spec:** `docs/superpowers/specs/2026-11-02-public-site-redesign-design.md` (решения 4.1–4.8, проверка — раздел 6),
ADR-0024.

## Global Constraints

- **Зависимость `motion`.** Ровно `"motion": "14.4.0"` в корневом `package.json`, без `^`. Импорт — только
  `motion/react`, только в `apps/site`. ESLint запрещает `motion` и `framer-motion` в `apps/web`, `apps/admin` и `libs/*`.
- **Тема.** Одна тёмная на весь сайт. Значения цветов — только в `apps/site/src/app/styles/site-theme.css`, по таблице
  4.1 спецификации:
  - `--ph-emerald-975 #04211B`, `950 #06302A`, `900 #0A3F37`, `800 #11524A`, `700 #0F6E56`;
  - `--ph-mint-50 #ECF7F2`, `300 #9CC7B8`, `400 #5DCAA5`, hover акцента `#7FD9BA` (`--ph-mint-200`).
  - Один акцент — мята. Чистого `#000` и `#fff` нет.
- **Радиусы:** плитки и экраны продукта — 24 px, кнопки — полностью скруглённые, поля — 12 px. Других радиусов нет.
- **Тени:** только у экранов продукта, `rgb(1 20 16 / 0.5)`. Свечения нет.
- **Шрифт:** TT Norms Pro (как есть).
  - Первый экран — Bold 56/60 px от 1024 px, 36/40 px на телефоне.
  - Заголовки секций — Bold 40/44 px.
  - Текст — 18/28 px, ширина до 60 знаков.
  - Акцент в заголовке — цветом мяты, тем же начертанием.
- **Тексты:**
  - ни одного `—` и `–` в словарях `ru.json`/`tg.json` и в разметке сайта;
  - заголовок секции — до 8 слов, абзац — до 25;
  - подзаголовок первого экрана — до 20 слов;
  - смысл и правдивость — как в части 3;
  - TG — перевод на ревью носителя, тест паритета зелёный.
- **Движение:**
  - анимируются только `transform` и `opacity`;
  - никаких `window.addEventListener('scroll')` и `useState` на кадр прокрутки — только `useScroll` / `useTransform`
    / `whileInView`;
  - при `prefers-reduced-motion: reduce` всё видно сразу, без параллакса, закрепления и бегущей строки;
  - пружина — `stiffness 100, damping 20`;
  - появление — `y: 24 → 0`, `opacity`, `once`, каскад 0,06 с.
- **Ярлычки** (мелкий текст в верхнем регистре над заголовком) — не больше одного на три секции.
- **Надпись главной кнопки** везде одна: «Оставить заявку».
- **Картинки:**
  - только экраны продукта на моках `apps/web` (синтетические данные);
  - WebP в `apps/site/public/images/`, до 1600 px по ширине, каждый ≤ 200 КБ;
  - `<img>` с `width`/`height` (CLS), без `next/image`.
- **Сайт остаётся серверным.** ISR 60 с, SEO (canonical, hreflang, sitemap, robots, Open Graph), адреса, форма и её
  проверки не меняются. Клиентские компоненты — только «листья» с `'use client'`.
- **Тесты отложены до MVP.** Новые тесты — только расширение теста словарей (запрет тире). Существующие тесты остаются
  зелёными.
- **Порты и окружение для живых проверок:**
  - API — `npx nx serve api` на `127.0.0.1:3010` (`.env` ворктри, отдельная БД);
  - сайт — `SITE_API_INTERNAL_URL=http://127.0.0.1:3010 API_PROXY_TARGET=http://127.0.0.1:3010 npx nx dev site`
    на `127.0.0.1:4400`;
  - порт 3000 не трогать;
  - `next dev` переписывает `apps/site/next-env.d.ts` и создаёт `apps/site/AGENTS.md`: вернуть и удалить до коммита.

## Решения плана

| № | Решение |
|---|---|
| R1 | Вход первого экрана — CSS `@keyframes` (подъём на 16 px и проявление, по строкам, 0,6 с) в `site-theme.css`, а не `motion`: LCP не ждёт гидратации. Экраны продукта на первом экране въезжают так же CSS; параллакс при прокрутке — `motion` |
| R2 | Элементы `Reveal` при отключённом JS видны: в `<head>` макета `<noscript><style>[data-reveal]{opacity:1!important;transform:none!important}</style></noscript>` |
| R3 | Секции, которых нет в теме кита (цветной блок, поверхность 975), — свои утилиты через `@theme` в `site-theme.css`: `--color-site-canvas`, `--color-site-block`, `--color-site-line`, `--color-accent-site`. Произвольных значений в классах (`bg-[#...]`) нет |
| R4 | Типографика сайта — утилиты `@theme`: `--text-display`, `--text-display-sm`, `--text-section`, `--text-lead` с высотой строки из R-значений Global Constraints |
| R5 | Шапка: `useScroll().scrollY` + `useMotionValueEvent` переключает атрибут `data-scrolled` на элементе (без перерисовки React), стили — по атрибуту |
| R6 | Закреплённые секции — `position: sticky`. Прогресс шагов — `useScroll({ target, offset: ['start center', 'end center'] })` → `scaleX` линии |
| R7 | Бегущая строка — CSS `@keyframes` translateX, `animation-play-state: paused` при наведении, при `reduce` — статичный перенос |
| R8 | Аккордеон вопросов — `<details>`; плавное раскрытие — CSS `interpolate-size: allow-keywords` + `::details-content` (где нет поддержки — открывается сразу) |
| R9 | Экраны продукта снимаются Playwright с моков `apps/web` в 2×, PNG переводится в WebP через `canvas.toBlob('image/webp', 0.86)` той же страницы Chrome. Скрипт — в scratchpad, не в репозитории |
| R10 | Проверка готовности — Playwright-скрипт в scratchpad на production-сервере сайта: LCP и CLS через `PerformanceObserver`, axe (`@axe-core/playwright`), ширина 375 без горизонтальной прокрутки, `reducedMotion: 'reduce'`. Отчёт с цифрами — в отчёте задачи |

## Review Focus

1. **`prefers-reduced-motion: reduce`.** Весь текст и все экраны видны сразу. Нет параллакса, закрепления, бегущей
   строки и входа первого экрана. Проверка — Task 1 (примитивы) и Task 7 (вся страница, `reducedMotion: 'reduce'`).
2. **JS не загрузился или гидратация медленная.** Первый экран и текст секций видны (R1, R2). Проверка — Task 7, режим
   без JS.
3. **Телефон 375 px.** Плитки, закреплённые секции и линия шагов складываются в колонку. Бегущая строка не даёт
   горизонтальной прокрутки, первый экран и кнопки видны без прокрутки. Проверка — Tasks 3–6, итог — Task 7.
4. **Длинные таджикские строки в крупном шрифте.** На `/tg` при 375 и 1440 px заголовки без переполнения (до 3 строк на
   телефоне), кнопки в одну строку от 1024 px. Проверка — Tasks 4–6.
5. **Компоненты кита на тёмной теме.** Поля формы, ошибки, фокус, кнопки кита читаемы (AA), фокус виден. Проверка —
   Task 1 (форма на `/connect`), Task 7 (axe по всем страницам).

---

### Task 1: Основа — зависимость, граница, тема, типографика, примитивы движения

**Files:**
- Modify: `package.json`, `package-lock.json` (`motion` 14.4.0); `eslint.config.mjs` (запрет `motion`, `framer-motion` вне
  `apps/site`)
- Create: `apps/site/src/app/styles/site-theme.css`; Modify: `apps/site/src/app/styles/global.css` (импорт темы)
- Modify: `apps/site/src/app/layouts/SiteLayout.tsx` (`<html data-theme="site">`, `<noscript>` R2, фон и цвет текста
  страницы)
- Create: `apps/site/src/shared/ui/motion/{Reveal.tsx, RevealGroup.tsx, Parallax.tsx, PressableLink.tsx, index.ts}`;
  экспорт из `apps/site/src/shared/ui/index.ts`
- Modify: `CLAUDE.md` (строка «Фронтенд-библиотеки»: `motion` — только `apps/site`, ADR-0024),
  `docs/architecture/stack.md` (та же строка), `.claude/skills` не трогать

**Interfaces:**
- Produces CSS: `data-theme="site"` переопределяет `--ph-color-bg`, `surface`, `surface-sunken`, `surface-highlight`,
  `fg`, `fg-muted`, `fg-subtle`, `border`, `border-strong`, `border-input`, `primary` (мята 400), `primary-hover`
  (мята 200), `primary-active`, `on-primary` (изумруд 975), `primary-subtle`, `focus-ring`, `danger` (с контрастом AA
  на 900). Утилиты R3 и R4: `bg-site-canvas`, `bg-site-block`, `border-site-line`, `text-accent-site`, `text-display`,
  `text-display-sm`, `text-section`, `text-lead`. Радиусы: `rounded-site-card` (24 px), `rounded-site-field` (12 px),
  кнопки — `rounded-full`. Классы входа R1: `site-enter`, `site-enter-delay-1..4`. Тень экрана: утилита `shadow-shot`.
- Produces components (`'use client'`, все уважают `useReducedMotion()`):
  - `Reveal({ children, as?: 'div'|'section'|'li'|'article', delay?: number, className? })` — `whileInView`, `once`,
    атрибут `data-reveal`;
  - `RevealGroup({ children, as?, className? })` и `RevealItem({ children, as?, className? })` — каскад 0,06 с
    через `staggerChildren`;
  - `Parallax({ children, speed: number, className? })` — `useScroll` + `useTransform` → `y` от `-speed*100` до
    `speed*100` px; включается только при `(min-width: 1024px)`;
  - `PressableLink({ href, children, variant: 'primary'|'secondary', size?: 'md'|'lg', className? })` — ссылка-кнопка
    с `whileHover={{ y: -1 }}` и `whileTap={{ scale: 0.98 }}`. Классы — `buttonClassName` из кита: `primary` = мята, а
    `secondary` — контур `border-site-line`.

- [ ] **Step 1:** `npm install --save-exact motion@14.4.0` в корне. Проверить, что в `package-lock.json` добавились только
  `motion`, `framer-motion`, `motion-dom`, `motion-utils` (`tslib` уже есть).
- [ ] **Step 2:** в `eslint.config.mjs` — `no-restricted-imports` с `paths` `motion`, `motion/react`, `framer-motion` для
  `apps/web/**`, `apps/admin/**`, `libs/**`: «ADR-0024: motion only in apps/site».
- [ ] **Step 3:** `site-theme.css`, импорт в `global.css`, `data-theme="site"` и `<noscript>` в `SiteLayout`.
- [ ] **Step 4:** примитивы движения и обновление CLAUDE.md и `stack.md`.
- [ ] **Step 5:** проверки:
  - `npx nx run-many -t lint test build fsd -p site web admin ui` → PASS;
  - `node tools/scripts/check-docs.mjs` → без ошибок.
  - Живая проверка на `next dev`:
    - все страницы в тёмной теме;
    - `/connect` — поля, подсказки, ошибка у поля и фокус читаемы (Review Focus 5);
    - контраст `fg-muted` на 975/950/900 — от 4,5:1, посчитать по значениям токенов.
- [ ] **Step 6:** коммит `feat(site): dark emerald theme, motion primitives (ADR-0024)`.

### Task 2: Экраны продукта для сайта

**Files:**
- Create: `apps/site/public/images/{pos.webp, stock-batches.webp, goods-receipt.webp, sales-report.webp, transfers.webp,
  owner-home.webp}`; Delete: `apps/site/public/images/pos.png` (и её использование заменить на `pos.webp` в Task 4)

**Interfaces:**
- Produces: шесть файлов выше. Для каждого в отчёте — натуральные `width × height`. Task 4 и 5 ставят их в `<img>`.

- [ ] **Step 1:** поднять `apps/web` на моках (`npx nx dev web`; если 4200 занят — `next dev` из `apps/web` на
  `127.0.0.1:4210` с `NEXT_PUBLIC_API_MOCKS=true`). Найти по `apps/web/src/shared/config/routes.ts` экраны: касса,
  остатки с партиями и сроками, приход товара, отчёт продаж, перемещения, главная владельца.
- [ ] **Step 2:** скрипт Playwright в scratchpad (R9):
  - канал `chrome` или `msedge`, окно 1280×800, `deviceScaleFactor: 2`;
  - снимок области экрана без системного шума: без тостов и плашки «демо-данные», если её можно скрыть настройкой
    моков, иначе обрезать;
  - перевод в WebP 0,86, ширина до 1600 px.
- [ ] **Step 3:** проверить размеры (≤ 200 КБ каждый). Просмотреть каждый снимок: только синтетические данные, нет
  реальных имён.
- [ ] **Step 4:** коммит `feat(site): product screenshots for the redesign`.

### Task 3: Шапка, подвал, страницы 404 и ошибки

**Files:**
- Modify: `apps/site/src/widgets/site-header/ui/{SiteHeader.tsx, LocaleSwitch.tsx}`; Create:
  `apps/site/src/widgets/site-header/ui/HeaderScrollState.tsx` (`'use client'`, R5)
- Modify: `apps/site/src/widgets/site-footer/ui/SiteFooter.tsx`
- Modify: `apps/site/app/[locale]/not-found.tsx`, `apps/site/app/[locale]/error.tsx`, `apps/site/app/global-error.tsx`,
  `apps/site/src/shared/ui/state-screen.ts`

**Interfaces:**
- Consumes: тема и `PressableLink` (Task 1).
- Produces: шапка фиксированная, высотой 72 px. Над первым экраном прозрачная; после 24 px прокрутки —
  `bg-surface-highlight/80` с `backdrop-blur` и `border-site-line` снизу (атрибут `data-scrolled`). Подвал — четыре
  колонки (бренд, разделы, документы, контакты), на телефоне — одна.

- [ ] **Step 1:** шапка по спецификации 4.5, п. 1. Пункты меню и кнопка — в одну строку от 1024 px. Меньше 1024 px —
  меню `<details>` на полный экран с появлением пунктов (`RevealGroup`, при `reduce` — сразу).
- [ ] **Step 2:** подвал 4.5, п. 11. Без декоративных строк и версий; контакты из настроек, как сейчас.
- [ ] **Step 3:** 404 и ошибка — крупная цифра (`text-display`, мята), текст, `PressableLink` «На главную».
- [ ] **Step 4:** проверки:
  - `npx nx run-many -t lint test build fsd -p site` → PASS.
  - Живая проверка:
    - шапка прозрачная наверху и с фоном после прокрутки, при 1440 в одну строку;
    - меню на 375 работает с клавиатуры;
    - `/xyz` и `/tg/xyz` — новая 404.
- [ ] **Step 5:** коммит `feat(site): header, footer and error screens in the new theme`.

### Task 4: Главная — первый экран, бегущая строка, «Для кого»

**Files:**
- Modify: `apps/site/src/pages/home/ui/sections/Hero.tsx`; Create: `apps/site/src/pages/home/ui/sections/HeroShots.tsx`
  (`'use client'`, параллакс)
- Create: `apps/site/src/pages/home/ui/sections/CapabilityMarquee.tsx`
- Modify: `apps/site/src/pages/home/ui/sections/Audience.tsx`, `apps/site/src/pages/home/ui/HomePage.tsx`
- Modify: `apps/site/src/shared/i18n/messages/{ru,tg}.json` (`home.hero.*`, `home.marquee.*`, `home.audience.*`)

**Interfaces:**
- Consumes: Task 1 (тема, `Reveal`, `Parallax`, `PressableLink`, `site-enter*`), Task 2 (`pos.webp`,
  `stock-batches.webp`, `sales-report.webp`).
- Produces: `HomePage` рендерит секции в порядке спецификации 4.5. Секции 5–10 пока прежние, их меняет Task 5.

- [ ] **Step 1:** первый экран (4.5, п. 2):
  - сетка `lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]`, на телефоне — колонка: текст, затем экраны;
  - заголовок `text-display` (до 2 строк, акцентное слово — `text-accent-site`), подзаголовок `text-lead` (до 20 слов);
  - две `PressableLink`: «Оставить заявку» (`primary`) и «Тарифы» (`secondary`);
  - справа три `<img>` экранов со сдвигом и наклоном (касса впереди, −3° и +2° у задних), `rounded-site-card`,
    `shadow-shot`;
  - вход — классы `site-enter*` (R1), параллакс — `Parallax` со скоростями 0,05 / 0,1 / 0,15;
  - `pos.webp` получает `fetchPriority="high"`, остальные — `loading="lazy"`;
  - `pos.png` удалить.
- [ ] **Step 2:** бегущая строка (4.5, п. 3; R7) — восемь возможностей, дублированных для бесшовности; `aria-hidden` у
  копии; при `reduce` — статичная строка с переносом.
- [ ] **Step 3:** «Для кого» (4.5, п. 4): сетка `lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)]`, слева `sticky top-28`
  заголовок `text-section`, справа четыре боли — `Reveal` на каждую, с иконкой из кита. На телефоне без закрепления.
- [ ] **Step 4:** тексты RU и TG секций 2–4 по ограничениям Global Constraints (без тире, длины).
- [ ] **Step 5:** проверки:
  - `npx nx run-many -t lint test build fsd -p site` → PASS.
  - Живая проверка на 1440 и 375:
    - первый экран целиком виден, кнопки без прокрутки;
    - параллакс есть только от 1024 px;
    - `/tg` — заголовок без переполнения (Review Focus 4);
    - эмуляция `reduce` — всё неподвижно.
- [ ] **Step 6:** коммит `feat(site): hero with product shots, capability marquee, audience section`.

### Task 5: Главная — возможности, подключение, тарифы, безопасность, вопросы, призыв

**Files:**
- Modify: `apps/site/src/pages/home/ui/sections/{Features.tsx, Steps.tsx, PricingTeaser.tsx, Security.tsx, Faq.tsx,
  CallToAction.tsx}`; Create: `apps/site/src/pages/home/ui/sections/StepsProgress.tsx` (`'use client'`, R6)
- Modify: `apps/site/src/app/styles/site-theme.css` (аккордеон R8, если нужно)
- Modify: `apps/site/src/shared/i18n/messages/{ru,tg}.json` (`home.features.*`, `home.steps.*`, `home.pricing.*`,
  `home.security.*`, `home.faq.*`, `home.cta.*`)

**Interfaces:**
- Consumes: Task 1, Task 2 (`pos.webp`, `stock-batches.webp`, `transfers.webp`, `goods-receipt.webp`, `owner-home.webp`).

- [ ] **Step 1:** возможности (4.5, п. 5) — ровно 6 плиток в сетке `lg:grid-cols-6`:
  - касса `lg:col-span-4 lg:row-span-2`, с экраном;
  - партии и сроки `lg:col-span-2`, с экраном;
  - закупки `lg:col-span-2`, `bg-site-block`;
  - цены и скидки `lg:col-span-2`;
  - перемещения `lg:col-span-3`, с экраном;
  - отчёты и Excel `lg:col-span-3`.

  Появление — `RevealGroup`. При наведении экран в плитке поднимается на 4 px (`motion`, при `reduce` — нет). На
  телефоне — одна колонка в том же порядке.
- [ ] **Step 2:** подключение (4.5, п. 6; R6):
  - пять шагов: заголовок шага — глагол (как в спецификации), без «Шаг N»;
  - горизонтальная линия с заполнением `scaleX` от 1024 px; текущий шаг — мята (по порогам прогресса);
  - на телефоне — вертикальный список с вертикальной линией `scaleY`;
  - при `reduce` линия полная и неподвижная.
- [ ] **Step 3:** тарифы (4.5, п. 7) — `bg-site-block` во всю ширину:
  - цена точки в месяц крупно (`text-display`, `formatMoney`), строка НДС, ссылка на `/tariffs`;
  - на блоке — только основной цвет текста (`fg`);
  - данные — из `getSiteInfo()`, как сейчас.
- [ ] **Step 4:** безопасность (4.5, п. 8) — две колонки, пять утверждений с иконками, тексты как в части 3.
- [ ] **Step 5:** вопросы (4.5, п. 9; R8) — `<details>` в теме, разделитель между вопросами одной линией, плавное
  раскрытие.
- [ ] **Step 6:** финальный призыв (4.5, п. 10) — `bg-site-block`, заголовок `text-section`, `PressableLink` «Оставить
  заявку».
- [ ] **Step 7:** тексты RU и TG секций 5–10. Ярлычков на всей главной — не больше трёх (подсчитать и указать в
  отчёте).
- [ ] **Step 8:** проверки:
  - `npx nx run-many -t lint test build fsd -p site` → PASS.
  - Живая проверка на 1440 и 375:
    - плитки без пустых ячеек;
    - линия шагов заполняется по прокрутке;
    - аккордеон открывается мышью и клавиатурой;
    - `reduce` — неподвижно, всё видно.
- [ ] **Step 9:** коммит `feat(site): bento features, connection steps, pricing block, security, faq, final call`.

### Task 6: Остальные страницы и тексты без тире

**Files:**
- Modify: `apps/site/src/pages/tariffs/ui/TariffsPage.tsx`, `apps/site/src/pages/blog/ui/BlogPage.tsx`,
  `apps/site/src/pages/article/ui/ArticlePage.tsx`, `apps/site/src/pages/legal/ui/LegalPage.tsx`,
  `apps/site/src/pages/connect/ui/ConnectPage.tsx`,
  `apps/site/src/features/connection-request/ui/ConnectionRequestForm.tsx` (только классы и раскладка)
- Modify: `apps/site/src/shared/i18n/messages/{ru,tg}.json` (остальные группы)
- Modify: `apps/site/src/shared/i18n/messages.spec.ts`

**Interfaces:**
- Consumes: Task 1 (тема, `Reveal`, `RevealGroup`, `PressableLink`).

- [ ] **Step 1:** тест в `messages.spec.ts`: `it('have no em or en dashes', …)` — ни одно значение словарей RU и TG не
  содержит `—` (U+2014) и `–` (U+2013). Запустить `npx nx test site` → FAIL (сейчас 17 в каждом словаре, часть уйдёт
  в Tasks 4–5).
- [ ] **Step 2:** заменить оставшиеся тире в словарях (точка, двоеточие, запятая, скобки) → тест PASS.
- [ ] **Step 3:** страницы по спецификации 4.6:
  - тарифы — крупная цена с НДС и плитки услуг;
  - блог — карточки каскадом, без обложки — плитка `bg-site-block`;
  - статья и документы — колонка 68 знаков в теме, `SiteMarkdown` с цветами темы (через токены, без правок кита);
  - заявка — две колонки: «что будет после заявки» (три пункта) и форма на `bg-surface-highlight`; экран «Заявка
    принята» — `Reveal`. Логику формы не трогать.
- [ ] **Step 4:** `grep` по `apps/site/src` и `apps/site/app` на `—` и `–` в разметке → пусто.
- [ ] **Step 5:** проверки:
  - `npx nx run-many -t lint test build fsd -p site` → PASS.
  - Живая проверка:
    - тарифы, блог (с обложкой и без), статья, оферта, заявка — на 1440 и 375;
    - ошибка 400 в форме видна у поля.
- [ ] **Step 6:** коммит `feat(site): tariffs, blog, article, legal and connect pages in the new theme`.

### Task 7: Проверка готовности на production-сборке

**Files:**
- Modify: только если проверка нашла дефекты — файлы, к которым они относятся.

**Interfaces:**
- Consumes: всё выше.

- [ ] **Step 1:** production-сборка `npx nx build site` и standalone-сервер (`PORT=4401 HOSTNAME=127.0.0.1
  SITE_API_INTERNAL_URL=http://127.0.0.1:3010 SITE_ORIGIN=http://127.0.0.1:4401`; `.next/static` и `public` скопированы
  в standalone-каталог), API на 3010.
- [ ] **Step 2:** скрипт Playwright в scratchpad (R10), страницы `/`, `/tg`, `/tariffs`, `/blog`, статья, `/offer`,
  `/connect`:
  - LCP (мс) и CLS при 1440 и 375 (сеть без ограничений и Fast 4G через `route` или CDP);
  - axe — нарушения уровня serious и critical;
  - `document.documentElement.scrollWidth <= innerWidth` при 375;
  - `reducedMotion: 'reduce'` — у элементов `[data-reveal]` `opacity` равно 1 сразу после загрузки;
  - `javaScriptEnabled: false` — заголовок первого экрана и тексты секций видимы (Review Focus 2).
- [ ] **Step 3:** порог:
  - LCP < 2500 мс и CLS < 0,1 на обеих ширинах;
  - axe — 0 serious и critical;
  - нет горизонтальной прокрутки;
  - `reduce` и режим без JS проходят.

  Что не проходит — исправить и повторить.
- [ ] **Step 4:** снимки главной на 1440 и 375 (обычный режим) — приложить к отчёту для пользователя.
- [ ] **Step 5:** `npx nx run-many -t lint test build fsd -p site web admin ui` → PASS. Коммит исправлений (если были)
  `fix(site): redesign checks`.
