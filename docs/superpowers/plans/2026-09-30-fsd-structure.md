# FSD-структура apps/web и apps/admin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перевести `apps/web` и `apps/admin` на структуру Feature-Sliced Design и включить автоматическую проверку слоёв (Steiger + ESLint).

**Architecture:** Маршруты Next.js — в корневой `app/` каждого приложения (только реэкспорты), пустая корневая `pages/` с README, код — в `src/` по слоям FSD с каноническими именами (`app`, `pages`, `widgets`, `features`, `entities`, `shared`). Steiger проверяет слои, public API и кросс-импорты; ESLint `no-restricted-imports` ловит импорты вверх по слоям и глубокие импорты прямо в редакторе.

**Tech Stack:** Nx 23, Next.js 16 (App Router, `output: 'export'`), React 19, TypeScript, Jest + Testing Library, ESLint 9 flat config, `steiger` 0.7.0, `@feature-sliced/steiger-plugin` 0.8.0.

**Spec:** `docs/architecture/adr/0017-feature-sliced-design.md` (с поправкой 2026-09-30), `CLAUDE.md` («Project structure», «Build / test / lint»).

## Global Constraints

- Слои FSD — канонические имена: `src/app`, `src/pages`, `src/widgets`, `src/features`, `src/entities`, `src/shared`; `_app` / `_pages` не использовать.
- Корень приложения: `app/` — только файлы маршрутов Next.js с реэкспортами; `pages/` — пустая, только `README.md`.
- Файл маршрута — одна строка реэкспорта: `export { XPage as default } from '@/pages/<slice>';`.
- Алиас `@/*` → `./src/*` (уже есть в `apps/*/tsconfig.json`).
- У каждого среза есть `index.ts` (public API); импорт внутрь среза извне — запрещён.
- Порядок слоёв сверху вниз: `app → pages → widgets → features → entities → shared`; слой импортирует только слои ниже.
- Steiger: `fsd.configs.recommended`, правило `fsd/insignificant-slice` — `warn`.
- Версии dev-зависимостей закреплены точно: `steiger` `0.7.0`, `@feature-sliced/steiger-plugin` `0.8.0`.
- `output: 'export'` в `next.config.js` не меняется; API routes и middleware не добавляются.
- Пустые слои (`widgets`, `features`, `entities`, `shared`) не создаются заранее (YAGNI) — появятся с первыми срезами.
- Полный прогон `npm run check` запускает пользователь (память проекта); в шагах — только проверки одного проекта.

## Review Focus

1. Кто-то удаляет «пустую» корневую `pages/` → Next.js начинает считать `src/pages` маршрутами и сборка падает (`pages and app directories should be under the same folder`). Ожидание: README объясняет назначение; тест Task 1 проверяет наличие `pages/README.md`.
2. Алиас `@/` в файле маршрута не резолвится в Jest (Nx-резолвер vs SWC) → тест маршрута падает, хотя `next build` работает. Ожидание: тест рендерит именно `app/page.tsx` (через алиас), а не только срез.
3. Глобальный CSS, перенесённый в `src/app`, не подключается в static export → стили пропадают. Ожидание: `out/index.html` ссылается на CSS-чанк (проверка в Task 1).
4. Нарушение слоёв не ловится ни Steiger, ни ESLint (например, фича импортирует страницу) → FSD деградирует незаметно. Ожидание: фикстура-нарушитель даёт ошибку в обоих инструментах (Task 3, Task 4).
5. Steiger на Windows завершается ненулевым кодом на чистом коде (замечено `Assertion failed … UV_HANDLE_CLOSING` при ошибках) → ложные падения таргета. Ожидание: на чистом дереве `npx nx fsd web` — код 0 (Task 3).

---

### Task 1: FSD-структура apps/web

**Files:**
- Create: `apps/web/app/layout.tsx`, `apps/web/app/page.tsx`, `apps/web/pages/README.md`
- Create: `apps/web/src/app/index.ts`, `apps/web/src/app/ui/RootLayout.tsx`, `apps/web/src/app/styles/global.css` (перенос из `src/app/global.css`)
- Create: `apps/web/src/pages/home/index.ts`, `apps/web/src/pages/home/ui/HomePage.tsx`, `apps/web/src/pages/home/ui/HomePage.module.css` (перенос из `src/app/page.tsx`, `src/app/page.module.css`)
- Delete: `apps/web/src/app/layout.tsx`, `apps/web/src/app/page.tsx`, `apps/web/src/app/page.module.css`, `apps/web/src/app/global.css`
- Modify: `apps/web/tsconfig.json` (`rootDir` → `"."`, `include` + `app/**/*.ts`, `app/**/*.tsx`)
- Modify: `apps/web/specs/index.spec.tsx`
- Modify: `apps/web/jest.config.cts` (`moduleNameMapper` для `@/`), `apps/web/tsconfig.spec.json` (`paths`, `include` для `specs/**` и `app/**`)

**Interfaces:**
- Produces: `RootLayout({ children }: { children: React.ReactNode }): JSX.Element` и `metadata: Metadata` из `@/app`; `HomePage(): JSX.Element` из `@/pages/home`. Шаблон, который Task 2 повторяет для admin.

- [ ] **Step 1: Переписать тест `apps/web/specs/index.spec.tsx`**

```tsx
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { render } from '@testing-library/react';
import RoutePage from '../app/page';
import { HomePage } from '@/pages/home';

describe('web FSD structure', () => {
  it('renders the root route through the pages layer', () => {
    const { baseElement } = render(<RoutePage />);
    expect(baseElement).toBeTruthy();
  });

  it('exposes HomePage via the slice public API', () => {
    expect(typeof HomePage).toBe('function');
  });

  it('keeps the empty root pages/ folder that shields src/pages from Next.js routing', () => {
    expect(existsSync(join(__dirname, '..', 'pages', 'README.md'))).toBe(true);
  });
});
```

- [ ] **Step 2: Запустить тест — должен упасть**

Run: `npx nx test web`
Expected: FAIL — `Cannot find module '../app/page'`.

- [ ] **Step 3: Перенести файлы и создать структуру**

- `git mv` существующих файлов в пути из блока **Files**; `HomePage` — именованный экспорт вместо `export default`, импорт стилей `./HomePage.module.css`.
- `src/app/ui/RootLayout.tsx` — бывший `layout.tsx`: `<html lang="ru">`, импорт `../styles/global.css`, `metadata` с `title: 'Pharmacy'`.
- `src/app/index.ts`: `export { RootLayout, metadata } from './ui/RootLayout';`
- `src/pages/home/index.ts`: `export { HomePage } from './ui/HomePage';`
- `app/layout.tsx`: `export { RootLayout as default, metadata } from '@/app';`
- `app/page.tsx`: `export { HomePage as default } from '@/pages/home';`
- `pages/README.md` — текст:

```markdown
# Not used

Next.js Pages Router is not used. This empty folder stops Next.js from treating the FSD
layer `src/pages` as routes (ADR-0017). Routes live in `app/`. Do not delete.
```

- `tsconfig.json`: `"rootDir": "."`, в `include` добавить `"app/**/*.ts"`, `"app/**/*.tsx"`.
- `jest.config.cts`: в объект `config` добавить `moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' }` (в конфиге резолв алиасов SWC отключён — Review Focus 2).
- `tsconfig.spec.json`: в `compilerOptions` добавить `"paths": { "@/*": ["./src/*"] }`; в `include` — `"specs/**/*.ts"`, `"specs/**/*.tsx"`, `"app/**/*.tsx"`.

- [ ] **Step 4: Запустить тест — должен пройти**

Run: `npx nx test web`
Expected: PASS, 3 tests.

- [ ] **Step 5: Проверить сборку static export**

Run: `npx nx build web --skip-nx-cache`
Expected: `Route (app)` содержит `○ /`; `apps/web/out/index.html` существует и содержит `<html lang="ru"` и ссылку на `/_next/static/css/`.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "refactor(web): FSD structure — routes in app/, layers in src/ (ADR-0017)"
```

### Task 2: FSD-структура apps/admin

**Files:** те же пути, что в Task 1, с `apps/admin` вместо `apps/web`.

**Interfaces:**
- Consumes: шаблон Task 1 (имена `RootLayout`, `metadata`, `HomePage`, текст `pages/README.md`).
- Produces: та же структура для admin; `metadata.title` — `'Pharmacy — операторы'`.

- [ ] **Step 1: Переписать `apps/admin/specs/index.spec.tsx`** — те же три теста, `describe('admin FSD structure', …)`.
- [ ] **Step 2: Запустить** `npx nx test admin` — Expected: FAIL `Cannot find module '../app/page'`.
- [ ] **Step 3: Повторить Step 3 из Task 1 для `apps/admin`.**
- [ ] **Step 4: Запустить** `npx nx test admin` — Expected: PASS, 3 tests.
- [ ] **Step 5: Сборка** `npx nx build admin --skip-nx-cache` — Expected: `○ /`, `apps/admin/out/index.html` с `<html lang="ru"` и CSS-ссылкой.
- [ ] **Step 6: Commit**

```bash
git add apps/admin
git commit -m "refactor(admin): FSD structure — routes in app/, layers in src/ (ADR-0017)"
```

### Task 3: Steiger — Nx-таргет `fsd` для обоих приложений

**Files:**
- Modify: `package.json` (devDependencies: `"steiger": "0.7.0"`, `"@feature-sliced/steiger-plugin": "0.8.0"`; script `check` → `nx run-many -t lint fsd test build`), `package-lock.json`
- Create: `apps/web/steiger.config.mjs`, `apps/admin/steiger.config.mjs`
- Modify: `apps/web/package.json`, `apps/admin/package.json` (`nx.targets.fsd`)

**Interfaces:**
- Consumes: структура Task 1–2.
- Produces: `npx nx fsd <web|admin>` — код 0 на чистом дереве, ненулевой при нарушении; таргет используется в job `checks` CI (план C).

- [ ] **Step 1: Установить зависимости**

Run: `npm install -D -E steiger@0.7.0 @feature-sliced/steiger-plugin@0.8.0`
Expected: версии в `package.json` без `^`.

- [ ] **Step 2: Создать `steiger.config.mjs` в обоих приложениях**

```js
import { defineConfig } from 'steiger';
import fsd from '@feature-sliced/steiger-plugin';

export default defineConfig([
  ...fsd.configs.recommended,
  { rules: { 'fsd/insignificant-slice': 'warn' } }, // ADR-0017: «pages first»
]);
```

- [ ] **Step 3: Добавить таргет `fsd` в `nx.targets` обоих `package.json`**

`{ "executor": "nx:run-commands", "cache": true, "inputs": ["{projectRoot}/src/**/*", "{projectRoot}/steiger.config.mjs"], "options": { "command": "steiger ./src", "cwd": "{projectRoot}" } }`

- [ ] **Step 4: Проверить чистое дерево**

Run: `npx nx fsd web --skip-nx-cache` и `npx nx fsd admin --skip-nx-cache`
Expected: код 0; допустимы только предупреждения `fsd/insignificant-slice`.

- [ ] **Step 5: Проверить, что нарушение ловится (временная фикстура, не коммитить)**

Создать `apps/web/src/features/probe/index.ts` с `export { HomePage as Probe } from '@/pages/home';`
Run: `npx nx fsd web --skip-nx-cache`
Expected: FAIL, `fsd/forbidden-imports` — «Forbidden import from higher layer "pages"». Удалить `apps/web/src/features/probe`.

- [ ] **Step 6: Обновить `check` в корневом `package.json`** — `"check": "nx run-many -t lint fsd test build"`.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json apps/web/steiger.config.mjs apps/admin/steiger.config.mjs apps/web/package.json apps/admin/package.json
git commit -m "build: Steiger fsd target for web and admin (ADR-0017)"
```

### Task 4: ESLint — запрет импортов вверх по слоям и глубоких импортов

**Files:**
- Create: `tools/eslint/fsd-layers.mjs`
- Modify: `apps/web/eslint.config.mjs`, `apps/admin/eslint.config.mjs`

**Interfaces:**
- Produces: `fsdLayerRules(): import('eslint').Linter.Config[]` из `tools/eslint/fsd-layers.mjs` — массив flat-config объектов, по одному на слой.

- [ ] **Step 1: Реализовать `fsdLayerRules()` в `tools/eslint/fsd-layers.mjs`**

Для каждого слоя `L` из `['app','pages','widgets','features','entities','shared']` — объект `{ files: ['src/<L>/**/*.{ts,tsx}'], rules: { 'no-restricted-imports': ['error', { patterns: [...] }] } }`:
- запрет слоёв выше `L`: для каждого вышележащего `U` — группы `@/<U>`, `@/<U>/*` с сообщением `FSD (ADR-0017): layer "<L>" must not import from higher layer "<U>".`;
- запрет глубоких импортов в срезы: группа `@/{pages,widgets,features,entities}/*/*` с сообщением `FSD (ADR-0017): import a slice only through its public API (index.ts).`

- [ ] **Step 2: Подключить в обоих `eslint.config.mjs`** — `import { fsdLayerRules } from '../../tools/eslint/fsd-layers.mjs';` и `...fsdLayerRules()` последним элементом массива.

- [ ] **Step 3: Проверить чистое дерево**

Run: `npx nx lint web --skip-nx-cache` и `npx nx lint admin --skip-nx-cache`
Expected: 0 ошибок.

- [ ] **Step 4: Проверить нарушения (временные фикстуры, не коммитить)**

- `apps/web/src/features/probe/index.ts`: `export { HomePage } from '@/pages/home';` → Run `npx nx lint web --skip-nx-cache` → Expected: `no-restricted-imports` с текстом `must not import from higher layer "pages"`.
- `apps/web/src/app/probe.ts`: `export { HomePage } from '@/pages/home/ui/HomePage';` → Expected: `import a slice only through its public API`.
- Удалить обе фикстуры.

- [ ] **Step 5: Commit**

```bash
git add tools/eslint/fsd-layers.mjs apps/web/eslint.config.mjs apps/admin/eslint.config.mjs
git commit -m "build: ESLint FSD layer rules for web and admin (ADR-0017)"
```

### Task 5: Документация команд

**Files:**
- Modify: `CLAUDE.md` (раздел «Build / test / lint»: строка `npx nx fsd web / admin   # Steiger — слои FSD (ADR-0017)`; раздел «CI/CD»: в job `checks` — таргет `fsd`)

- [ ] **Step 1: Внести две строки в `CLAUDE.md`.**
- [ ] **Step 2: Проверить** — `grep -n "nx fsd" CLAUDE.md` — Expected: 1 строка в «Build / test / lint».
- [ ] **Step 3: Попросить пользователя запустить полный прогон** `npm run check` — Expected: все проекты зелёные.
- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: nx fsd target in CLAUDE.md (ADR-0017)"
```
