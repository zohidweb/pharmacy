# Касса и истёкшая сессия (ревью безопасности F2, F3, F6): план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** web и admin замечают завершённую сервером сессию и уводят на вход; касса не продаёт от имени кассира, чья
сессия истекла; выход при обрыве связи блокирует терминал и досылает выход, когда связь вернётся.

**Architecture:**
- Глобальная обработка: `onError` у `QueryCache` и `MutationCache` в обоих приложениях. Ответ 401 с кодом
  `unauthenticated` (сессии нет; ошибки входа — другие коды) сбрасывает сессию в кэше. `AppShell` уже уводит на вход
  при пустой сессии, на привязанном терминале — к PIN.
- Касса: продажа без живой сессии сервер принимает «под терминалом» сразу (P9/P10, без 401). Поэтому перед продажей
  онлайн касса сама проверяет сессию, если не проверяла её 60 с. Офлайн касса продаёт как раньше (ADR-0015).
- Выход при обрыве: метка «выход не дошёл» с `authenticatedAt` сессии. Пока метка стоит, прежняя сессия не
  возвращается: при связи выход досылается.

**Tech Stack:** React 19, TanStack Query 5, Next.js static export (ADR-0015, ADR-0017 FSD). Новых зависимостей нет.

**Spec:** `docs/architecture/reviews/2026-10-22-security-review.md`, находки F2, F3, F6 (и отчёт
`2026-10-22-security-review/r4-frontend.md`); ADR-0015 (буфер кассы, ось 3), ADR-0008 и спецификация
`2026-10-21-pos-offline-limits` (P9–P11, P17, P18).

## Решения автора (на утверждение вместе с планом)

| № | Вопрос | Решение |
|---|---|---|
| S1 | Что считать концом сессии | 401 с `code === 'unauthenticated'`. Коды `invalid_credentials`, `invalid_pin`, `invalid_code` (неверный вход) и 403 (`fresh_auth_required`, нет права) сессию не сбрасывают |
| S2 | Что делает сброс | Забыть запомненную сессию терминала (`forgetTerminal`), удалить все запросы, кроме сессии, записать в сессию `null`. Буфер кассы в IndexedDB не трогается. Тот же сброс — в обычном выходе web и в выходе admin (F6: admin сейчас оставляет кэш) |
| S3 | Проверка перед продажей | Только онлайн (`onlineManager.isOnline()`). `fetchQuery` сессии со `staleTime` 60 000 мс: если сессию проверяли меньше 60 с назад, запроса нет. Тайм-аут проверки 3 с; недоступность или тайм-аут — продажа идёт как офлайн. Только ответ «сессии нет» (`null`) отменяет продажу и уводит к PIN. Проверка продлевает простой сессии: продажа — это активность кассира |
| S4 | Пауза буфера | Когда отправитель встаёт на паузу (401/403), касса перепроверяет сессию: если её нет — уход к PIN |
| S5 | Выход при обрыве (F3) | Если `DELETE /sessions/current` не дошёл (недоступность или тайм-аут): метка в `localStorage` (`pharmacy-sign-out-pending` = `authenticatedAt` сессии), локальный сброс и вход. `fetchSession` с меткой: недоступно — `null` (терминал заблокирован, PIN без связи и так не войдёт); на связи и сервер вернул ту же сессию — досылает выход и снимает метку; вернул другую (новый вход) или 401 — снимает метку. Иные ошибки выхода — как сейчас, сообщение |
| S6 | Остаток риска | Продажа, начатая в первые 60 с после конца сессии, ещё уйдёт от прежнего кассира, а сервер примет её по P10. Это граница S3, а не дыра: тайм-аут сети — не меньше 5 минут |

## Global Constraints

- Тесты отложены до MVP — живая проверка в браузере (web dev на 4210 + `api-oc-4210`); существующие наборы зелёные.
- FSD (ADR-0017): общая логика сессии — в `entities/session`, распознавание кода — в `shared/api`; страницы и
  `app` используют их через публичный API среза.
- Порты 4200/4201 не использовать.
- `localStorage` — в `try/catch`: недоступное хранилище не ломает выход (метка просто не ставится).
- Коммиты `--no-gpg-sign`, Conventional Commits, `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Неверный пароль или PIN.** Ожидается: форма входа показывает ошибку, сессия и кэш не сбрасываются (код не
   `unauthenticated`). Проверка — задача 1, ш. 3, c3.
2. **Касса офлайн.** Ожидается: продажа без задержки (проверки нет), чек в буфере. Проверка — задача 2, ш. 3, k3.
3. **Сеть «висит» (запрос не отвечает).** Ожидается: проверка сессии сдаётся через 3 с, продажа идёт в буфер.
   Проверка — задача 2, ш. 3, k4.
4. **Новый вход после выхода при обрыве.** Ожидается: метка не удаляет новую сессию — `authenticatedAt` другой.
   Проверка — задача 3, ш. 3, o3.
5. **403 `fresh_auth_required` в диалогах сотрудников и ролей.** Ожидается: окно пароля, как раньше, без выхода.
   Проверка — задача 1, ш. 3, c4.

---

### Task 1: Глобальный конец сессии в web и admin

**Files:**
- Modify: `apps/web/src/shared/api/client.ts` (и экспорт в `shared/api/index.ts`), `apps/admin/src/shared/api/client.ts`
  (и экспорт).
- Create: `apps/web/src/entities/session/api/session-reset.ts`, `apps/admin/src/entities/session/api/session-reset.ts`
  (экспорт из `index.ts` срезов).
- Modify: `apps/web/src/app/bootstrap/AppProviders.tsx`, `apps/admin/src/app/bootstrap/AppProviders.tsx`,
  `apps/web/src/features/sign-out/api/sign-out.ts`, `apps/admin/src/pages/profile/ui/ProfilePage.tsx`.
- Scratchpad: `s_lock.md` — сценарии браузера.

**Interfaces — Produces:**
- `isSessionEnded(error: unknown): boolean` — `ApiError` с `status === 401` и `code === 'unauthenticated'` (S1), в
  `shared/api` обоих приложений.
- `resetSession(queryClient: QueryClient): void` — S2: web забывает и терминал (`forgetTerminal`); admin — без
  терминала.

- [ ] **Step 1:** `isSessionEnded`, `resetSession`; `onError` в `QueryCache` и `MutationCache` обоих `AppProviders`
  (существующий `onSuccess` счётчиков меню сохраняется).
- [ ] **Step 2:** `useSignOut` web и выход admin используют `resetSession` (admin больше не оставляет кэш, F6).
- [ ] **Step 3: Живая проверка** (браузер, сеть `cat_setup.sh`):
  - c1 — владелец вошёл, открыл «Сотрудники»; сессия удалена на сервере (ключ сессии в Redis dev, DB 0) →
    следующий запрос даёт 401 → экран входа;
  - c2 — то же в admin с сессией оператора → вход оператора;
  - c3 — неверный пароль → ошибка в форме, без сброса;
  - c4 — изменение сотрудника по истечении «свежего входа» → окно пароля (403), без выхода.
- [ ] **Step 4:** `npx nx run-many -t lint test -p web admin`; `npx nx fsd web admin`.
  Expected: зелено.
  Commit: `fix(web,admin): a session ended by the server returns to the sign-in (security review F2)`.

### Task 2: Касса не продаёт без живой сессии

**Files:**
- Modify: `apps/web/src/entities/session/api/session-queries.ts` (`ensureSession`),
  `apps/web/src/pages/pos/ui/PosPage.tsx` (перед оплатой),
  `apps/web/src/entities/terminal/model/use-terminal.ts` (пауза буфера).

**Interfaces:**
- Consumes: `resetSession`, `isSessionEnded` (Task 1).
- Produces: `ensureSession(queryClient: QueryClient): Promise<EmployeeSession | null | undefined>` — `null`: сессии
  нет (сброс уже сделан); `undefined`: проверить нельзя (офлайн, недоступно, 3 с) — продажа идёт; сессия — жива.
  Константы `SESSION_CHECK_MS = 60_000`, `SESSION_CHECK_TIMEOUT_MS = 3_000`.

- [ ] **Step 1:** `ensureSession`: офлайн (`onlineManager.isOnline()` ложно) → `undefined`; иначе `fetchQuery`
  (`sessionQueryKey`, `staleTime: SESSION_CHECK_MS`, `networkMode: 'always'`, запрос `sessions.current` с
  `timeoutMs: SESSION_CHECK_TIMEOUT_MS`); недоступно или тайм-аут → `undefined`; `null` → `resetSession` и `null`.
- [ ] **Step 2:** в `PosPage`, перед `setPaying(true)`: `null` — продажи нет (экран уходит к PIN сам). В
  `useTerminalRuntime`: переход `paused` в `true` → `invalidateQueries(sessionQueryKey)` (S4).
- [ ] **Step 3: Живая проверка** (касса `pos_setup.sh`, PIN-сессия кассира):
  - k1 — сессия кассира удалена на сервере, касса онлайн, прошло > 60 с с последней проверки → «Оплатить» → чек не
    создан, экран PIN; в буфере пусто;
  - k2 — то же, но проверка была < 60 с назад → продажа уходит (граница S6), экран не меняется;
  - k3 — API остановлен (касса офлайн) → продажа сразу, чек в буфере;
  - k4 — API «висит» (порт отвечает без ответа — заглушка на 3000) → через ≈ 3 с продажа в буфере;
  - k5 — терминал отвязан (буфер получил 401/403, пауза) → проверка сессии → экран PIN или входа.
- [ ] **Step 4:** `npx nx run-many -t lint test -p web`; `npx nx fsd web`.
  Commit: `fix(web): the POS checks the session before a sale online (security review F2)`.

### Task 3: Выход при обрыве блокирует терминал

**Files:**
- Create: `apps/web/src/entities/session/model/pending-sign-out.ts` (`markSignOutPending(authenticatedAt)`,
  `pendingSignOut(): string | null`, `clearSignOutPending()`; ключ `pharmacy-sign-out-pending`).
- Modify: `apps/web/src/entities/session/api/session-queries.ts` (`fetchSession`, S5),
  `apps/web/src/features/sign-out/api/sign-out.ts` (`onError`).

**Interfaces:**
- Consumes: `resetSession` (Task 1), `isUnreachable` (`shared/api`).

- [ ] **Step 1:** метка (S5), `useSignOut.onError`: недоступность — метка `authenticatedAt` текущей сессии, сброс,
  вход; иначе — как сейчас.
- [ ] **Step 2:** `fetchSession` по S5 (метка проверяется до запасной запомненной сессии).
- [ ] **Step 3: Живая проверка:**
  - o1 — кассир вошёл по PIN; API остановлен; «Выйти» → экран входа (PIN неактивен без связи); перезагрузка →
    снова вход, не прежний кассир;
  - o2 — API запущен; перезагрузка → выход дослан: прежняя cookie на сервере больше не действует, метки нет;
  - o3 — после o1 при связи вошёл другой кассир по PIN → его сессия жива после перезагрузки (метка снята, а не
    дослана);
  - o4 — выход онлайн — как раньше.
- [ ] **Step 4:** `npx nx run-many -t lint test -p web`; `npx nx fsd web`; документы: если отчёт ревью уже в `main`
  (PR `feature/security-review`), в разделе 8.1 пункт 4 — «сделано»; иначе — строка в описании PR. Пользователь —
  `npm run check`.
  Commit: `fix(web): signing out in an outage locks the terminal until the sign-out reaches the server (security review F3)`.
