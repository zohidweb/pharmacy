# R4 — Frontends: apps/web, apps/admin, libs/ui

Repository main 80c4973, reviewed read-only on 2026-10-22. Finding prefix F.

## 1. Scope covered

- **Build and config.** I read `apps/{web,admin}/next.config.js`, `apps/{web,admin}/package.json` (Nx targets), `nx.json` and the resolved Nx build targets in `.nx/workspace-data/project-graph.json`. I also read the build function of `tools/scripts/stack.mjs`, `tools/scripts/build-sw.mjs` and `apps/web/sw/{sw.template.js,kill-switch.js}`. I grepped the built `apps/{web,admin}/out` (HTML, `sw.js`, chunks).
- **API clients and mocks.** `shared/api/{client,index,routes,fresh-auth}.ts` in both apps, `mocks/{session,transport}.ts` and `app/bootstrap/{AppProviders,ServiceWorker}.tsx`.
- **Browser storage.** `shared/lib/offline-queue/*` (controlled-crypto, db, queue, operations, runtime, buffer-state), `shared/lib/terminal-cache`, `features/pos/model/{pos-store,pay}.ts`, `entities/{session,terminal,shift}`, `features/sign-out`, the locale stores and `AnnouncementsBanner`.
- **XSS, print and import.** I grepped all of apps/web, apps/admin and libs/ui for HTML, URL and window sinks. I read `libs/ui/src/lib/print/*`, `features/pos/lib/receipt-print.ts`, `shared/lib/spreadsheet/{zip,xlsx}.ts`, `features/data-import/model/csv-out.ts`, `Export1cDialog` and the route builders.
- **Auth UI.** The login and activation pages, `PinLoginForm`, `ConfirmPasswordDialog`, the scanner hook, the admin `ProfilePage` logout and `UiKitPage`.
- **Docs.** ADR-0008, ADR-0012 (headers and CSP), ADR-0015, ADR-0018 and spec 2026-10-21-pos-offline-limits (P10, P17, P18).

## 2. Findings

### F1 — Medium — A test or prod build can silently ship the API mocks and the demo session

- **Location:** `tools/scripts/stack.mjs:203-205`; `apps/web/package.json:44-59` (build inputs); the admin build target (inferred, no override); `apps/web/next.config.js:12`; `apps/web/src/shared/api/index.ts:95-100`; `apps/web/src/shared/api/mocks/session.ts:88-100`.
- **Evidence:** `stack.mjs` builds with `env: { ...process.env, NODE_ENV: 'production', … }` and does not pass `--skip-nx-cache`. The resolved Nx `build` targets of web and admin have `cache: true`, and their inputs contain no `{ "env": "NEXT_PUBLIC_API_MOCKS" }`.
- **Attack / failure scenario:**
  - **How it happens.** The team's plans build web with `NEXT_PUBLIC_API_MOCKS=partial` for manual checks; `docs/superpowers/plans/2026-10-20-data-import.md:561-562` already notes that a rebuild needs `--skip-nx-cache` afterwards. The next `npm run stack -- prod build` from the same tree gets the same Nx hash and restores the mock build into `apps/*/out`. A shell that still exports the variable has the same effect.
  - **With `true`:** pilot staff sign in against in-memory mocks, and the fixture demo password works. Sales, cash operations and ПКУ records stay in the browser tab and never reach the API, while the UI looks normal.
  - **With `partial`:** some screens answer as the demo owner `firuz` with demo data and drop writes. In web these are price conflicts, catalog duplicates, sync and 1C; in admin, licences and installations.
  - No runtime guard catches either case. The current `out/` is clean: it holds no mock chunk.
- **Recommendation:**
  - Add `{ "env": "NEXT_PUBLIC_API_MOCKS" }` to the build inputs of web and admin.
  - In `stack.mjs build`, fail when the variable is set, and pass `--skip-nx-cache` for test and prod.
  - After the build, fail if `out/` contains a mock marker such as `pharmacy-web-mock-session`.
- **Confidence:** confirmed for the mechanism; the cache replay needs a runtime check.

### F2 — Medium — The SPA ignores a session the server has ended; the POS keeps selling as the timed-out cashier

- **Location:** `apps/web/src/app/bootstrap/AppProviders.tsx:42-55` (no global query or mutation error handling); `apps/web/src/entities/session/api/session-queries.ts:58-66`; `apps/web/src/shared/lib/offline-queue/queue.ts:88,233-237`; `apps/web/src/widgets/app-shell/ui/ConnectionStatus.tsx:108`; `apps/admin/src/entities/session/api/session-queries.ts:17-23`.
- **Evidence:** the session query uses `staleTime: Number.POSITIVE_INFINITY`. A 401 on an outbox send only sets `paused: true`, which the UI shows as «Отправка ждёт входа в систему». `buffer-state.ts` does not block sales while the outbox is paused.
- **Attack / failure scenario:**
  - A cashier leaves the POS. The server ends the PIN session: `posSessionTimeoutMinutes` passes, the employee is blocked, or the 12 h absolute limit is reached.
  - The open tab keeps working. Anyone at the counter can ring sales, including ПКУ up to the ПКУ buffer limit. The sales are buffered with the absent cashier's `employeeId`.
  - After the next PIN sign-in the buffer is sent. Under spec P10 the server accepts these sales, because that cashier was the last to hold the terminal.
  - The result: the cashier timeout that CLAUDE.md requires has no effect in an open tab, until the page is reloaded.
  - On owner and operator PCs, screens already loaded (reports, employees, tenants, invoices) stay visible after the session expires.
- **Recommendation:**
  - Add a global `onError` to the QueryCache and MutationCache. On an `ApiError` 401 from any route except sign-in: clear the query cache, set the session to null and route to the sign-in screen (the PIN form on a terminal). Keep the IndexedDB buffer.
  - Treat a paused outbox as "sales blocked until a PIN sign-in".
- **Confidence:** confirmed in the frontend; that the server accepts these sales via P10 is likely and is for the API reviewer to confirm.

### F3 — Low — Signing out during an outage leaves the terminal open as the same cashier

- **Location:** `apps/web/src/features/sign-out/api/sign-out.ts:13-21`; `apps/web/src/entities/session/api/session-queries.ts:50-53`.
- **Evidence:** the local cleanup (`forgetTerminal()` and the cache purge) runs only in `onSuccess` of `DELETE /sessions/current`.
- **Attack / failure scenario:**
  - During an outage, cashier A presses «Выйти». The request fails and an error is shown, but the remembered profile and the server session stay.
  - A leaves. B reloads the page, `fetchSession` falls back to A's remembered session, and B sells under A's name.
  - The server accepts these sales per P10.
- **Recommendation:**
  - When the DELETE cannot reach the server, still lock the terminal locally: call `forgetTerminal`, set the session to null, and route to the sign-in with PIN entry disabled until the connection returns.
  - Retry the DELETE on reconnect and keep the buffer.
- **Confidence:** confirmed.

### F4 — Low — Terminal data, including sealed ПКУ data and its key, is never removed after the browser is unbound

- **Location:** `apps/web/src/entities/terminal/api/bound-terminal.ts:93-96`; `apps/web/src/shared/lib/offline-queue/controlled-crypto.ts:24-37`; `apps/web/src/shared/lib/offline-queue/db.ts:62-67`.
- **Evidence:** a 404 `not_bound` only calls `forgetBinding()`. The database `pharmacy-pos:<tenant>:<store>` stays, with its outbox, quarantine, draft and catalog snapshot. The AES-GCM key stays in that database's `state` store.
- **Attack / failure scenario:**
  - An owner unbinds a PC: it was replaced, handed to another chain on the platform, or is suspected stolen.
  - Quarantined or unsent sales stay in the browser profile indefinitely. They hold the prescription number, clinic, doctor, buyer name and buyer document.
  - Anyone using that profile can open the database in DevTools on the origin and call `crypto.subtle.decrypt` with the stored CryptoKey. `extractable: false` only blocks `exportKey`; the browser persists the key material with the profile.
- **Recommendation:**
  - On `not_bound`, delete that binding's POS databases (idb `deleteDB`) when nothing is pending.
  - Leftover operations can never be sent from that browser. Show them to the manager and purge them after an explicit decision.
  - State in the docs that E17 encryption protects only against casual viewing.
- **Confidence:** confirmed for the retention; likely for the key material on disk.

### F5 — Info — Checks the UI makes that the server must enforce (for the API reviewer)

The UI hides or computes the following. The server has to enforce each one independently:

- Access to menu items and screens by permission: `apps/web/src/widgets/app-shell/config/navigation.ts:27-106`.
- Selling a ПКУ product requires `pos:sell-controlled` (`apps/web/src/pages/pos/ui/PosPage.tsx:203`). The prescription and buyer-document fields are required only in the dialog (`features/pos/ui/PosDialogs.tsx:168`); the API accepts `{}` (decision K3).
- The client asserts `batchChosenManually` (`features/pos/model/pay.ts:63`; `pos:choose-batch` at `PosPage.tsx:124`). The server must compare the batch with FEFO itself.
- The client sends `unitPriceMinor`, `amountMinor`, `discountRuleId`, `piecesPerPack`, `employeeId` and `occurredAt` (`libs/shared/dto/src/lib/tenant-pos.ts:98-160`).
- Buffer limits (500 operations or 24 h, ПКУ 20 or 8 h, the P17 sign-in age) are enforced only in the browser (`shared/lib/offline-queue/buffer-state.ts:42,75`).
- Unbinding a terminal is offered only to password sessions (`pages/owner/employees/ui/EmployeesPage.tsx:381-382`).
- Write blocking during view-only impersonation is done by `canWrite` (`entities/session/model/access.ts:19`).

### F6 — Info — Admin logout keeps the query cache

`apps/admin/src/pages/profile/ui/ProfilePage.tsx:275-280` sets the session to null but leaves every other query in place; web removes them (`sign-out.ts:16-19`). Tenant lists, invoices and audit data stay in the tab's memory and appear instantly to the next operator who signs in on that tab. Both operators have the same rights, so the impact is low. Fix: call `removeQueries`, as web does.

### F7 — Info — The Service Worker precache manifest includes `/.gitkeep`

`apps/web/public/.gitkeep` is copied into `out/` and listed in the manifest (`apps/web/out/sw.js:13`); `build-sw.mjs:17` skips only `sw.js`. If the proxy is hardened to refuse dotfiles, `cache.addAll` rejects and the worker never installs. The POS then silently loses offline reload. Skip dotfiles in `build-sw`.

### F8 — Info — Money writes without an idempotency key

- `expenses.create` sends no key: `apps/web/src/pages/owner/expenses/ui/ExpenseDialog.tsx:102`. The API takes none either: `apps/api/src/app/reports/expenses.controller.ts:33`.
- The operator writes `invoices.recalculate`, `payments.update`, `payments.cancel` and `tenants.addDiscount` send none: `apps/admin/src/pages/billing/ui/InvoiceDialogs.tsx:358,464,481`; `TenantDiscounts.tsx:62`.

After a 15 s client timeout, a second click can create a duplicate expense. Correlation IDs are present. Add a key per dialog where the API supports one.

### F9 — Info — The dev servers listen on all interfaces and proxy /api

The `dev` and `dev-api` targets run `next dev -p 4200` and `-p 4300` without `-H` (`apps/{web,admin}/package.json:15,25`). Next listens on all interfaces by default, and `next.config.js:17-20` proxies `/api` to the local API. On a shared LAN, others can reach the dev UI and, through it, the dev API. The data is synthetic. Add `-H 127.0.0.1`. Needs a runtime check.

## 3. Controls verified

**XSS and URLs**
- No HTML sinks: a grep for `dangerouslySetInnerHTML`, `innerHTML`, `document.write`, `window.open`, `eval` and `new Function` finds nothing in apps/web, apps/admin or libs/ui. There are no `target="_blank"` links and no `message` listeners other than the Service Worker's typed one (`sw.template.js:38-40`).
- Operator announcements are rendered as React text in web, and tenant data is rendered as React text in admin. Neither `t.rich` nor `t.markup` is used anywhere.
- Receipts and invoices print as React text through a portal; no HTML strings are built (`libs/ui/src/lib/print/ReceiptPrint.tsx:45-46,68-72`; `SheetPrint.tsx:24-25`).
- Ids are URL-encoded in screen links (`apps/web/src/shared/config/routes.ts:29,38`; `apps/admin/src/shared/config/routes.ts:12-23`) and in API paths (`apps/web/src/shared/api/routes.ts:199`; `apps/admin/src/shared/api/routes.ts:114`).
- There is no open redirect: after sign-in the target is derived from the session, never from the URL (`apps/web/src/pages/login/ui/LoginPage.tsx:42-46`; `apps/admin/src/pages/login/ui/LoginPage.tsx:21,34`). Activation codes are typed, never read from the URL.
- The 1C `downloadUrl` link is hidden in production (`pages/owner/reports/ui/ReportsPage.tsx:135`), and React 19 blocks `javascript:` URLs.

**File import**
- XLSX import refuses encrypted zip entries and caps unpacked size against zip bombs (`shared/lib/spreadsheet/zip.ts:72,100-107`). Malformed XML is rejected (`xlsx.ts:41-43`).
- CSV export quotes cells (`csv-out.ts:6-7`). Every cell starts with interface text, so no exported cell can start with a formula.

**API client**
- Requests are same-origin with `credentials: 'same-origin'` (`apps/web/src/shared/api/client.ts:84`; `apps/admin/src/shared/api/client.ts:79`). No token exists in JS: `document.cookie` is never used.
- Every request gets an `X-Correlation-Id` from `crypto.randomUUID()` (web `client.ts:87,354`; admin `client.ts:82,213`). Problem bodies are mapped to codes and never logged (`client.ts:111-121`).
- Idempotency keys:
  - POS operations use their UUIDv7 id as the key (`offline-queue/operations.ts:88`; `features/pos/model/pay.ts:34`; `libs/shared/util/src/lib/id.ts:8`).
  - Supplier payments: `SupplierDialogs.tsx:396,427`.
  - Customer returns: `ReturnsPage.tsx:386`.
  - Invoice generation: `InvoiceDialogs.tsx:82`.
  - Data imports: `CheckStep.tsx:57`.
- Password re-confirmation runs in a dialog and repeats the action once (`shared/api/fresh-auth.ts:72-81`).

**Builds**
- Builds without the flag contain no mock code (`apps/web/src/shared/api/index.ts:95-100`). The current `out/` contains `API mocks are disabled` and no mock-session key.
- The dev proxy is added only in development and is not part of the export (`apps/{web,admin}/next.config.js:17-20`).
- The admin UI-kit catalog renders a 404 in production (`apps/admin/src/pages/ui-kit/ui/UiKitPage.tsx:5-19`).
- No third-party runtime resources load: built chunks reference only nextjs.org and react.dev error-doc strings. Fonts are self-hosted under `/_next/static/media`.

**Browser storage**
- `localStorage` holds only the locale and dismissed announcement ids (`shared/i18n/locale-store.ts:16`; `AnnouncementsBanner.tsx:17`). `sessionStorage` is used only by the mocks.
- The terminal cache remembers only sessions bound to a terminal, without the phone (`shared/lib/terminal-cache/terminal-cache.ts:50-56`). It is forgotten on sign-out and on a 401 (`sign-out.ts:15`; `session-queries.ts:46-48`).
- Web sign-out removes every cached query (`features/sign-out/api/sign-out.ts:16-19`).
- ПКУ encryption:
  - AES-GCM with a 256-bit non-extractable key (`offline-queue/controlled-crypto.ts:27-31`) and a fresh 12-byte IV per record (`:63`).
  - Applied in the outbox (`pay.ts:127`) and in the draft (`features/pos/model/pos-store.ts:50-62,106`).
  - Records are deleted on delivery (`queue.ts:214`). The quarantine list is never decrypted (`ShiftPage.tsx:349`).
- One database per tenant and store (`offline-queue/db.ts:62`); one sender per terminal through Web Locks (`queue.ts:192-194`); 401/403 pauses the sender, 4xx quarantines, nothing is deleted silently (`queue.ts:84-90,233-243`); `storage.persist()` is requested (`runtime.ts:53`).

**Service Worker**
- Leaves `/api/*`, non-GET and cross-origin requests to the network (`apps/web/sw/sw.template.js:49-52`).
- The precache version is a content hash (`build-sw.mjs:31-36`), and old caches are dropped on activation (`sw.template.js:21-35`).
- Registered only in a production cloud deployment (`app/bootstrap/ServiceWorker.tsx:26-36`). A new version activates only while the cart is empty (`:18,47`).
- A kill switch exists (`apps/web/sw/kill-switch.js:5-16`). Admin has no worker.

**Input fields**
- The scanner ignores password fields (`shared/lib/scanner/use-barcode-scanner.ts:98`).
- The PIN field is `type="password"` with `autoComplete="off"` (`features/auth-by-pin/ui/PinLoginForm.tsx:98-100`).

## 4. Accepted limitations touched

- **ADR-0012, CSP with `script-src 'unsafe-inline'`.** The export has 168 inline RSC `<script>` tags in web and 72 in admin, and no style attributes or `<style>` tags. The code matches; a strict CSP needs build-time hashes (planned after MVP).
- **ADR-0015 axis 3, terminal reopens offline with the remembered profile.** Matches (`session-queries.ts:50-53`), and only sessions bound to a terminal are remembered. F3 is a gap in this design.
- **ADR-0015, decision of 2026-09-30, ПКУ in the buffer encrypted with a non-extractable AES-GCM key in IndexedDB.** Matches. Deletion on server confirmation matches; quarantined data is kept, as "no silent deletion" requires. The key sits next to the data (F4).
- **ADR-0015, "продажа — факт".** The client sends prices, discount and pack size, and the server only marks differences. Matches (F5 list).
- **ADR-0015 and spec P18, buffer sent without a session under the device-cookie.** Matches: the author is the payload's `employeeId`, checked by P10 on the server.
- **Spec P17, idle time not counted offline.** Matches; only the sign-in age blocks sales. F2 concerns the online case.
- **ADR-0015 axis 6b, Service Worker only in cloud web, `/api` not cached, kill switch, updates between receipts.** Matches.
- **ADR-0008, HttpOnly `__Host-sid` on one origin, CSRF by Origin and Sec-Fetch-Site.** The client matches: same-origin fetch and JSON bodies. Unsafe requests without a body (`DELETE /sessions/current`, posting actions) carry no Content-Type and rely on the Origin check alone. That check belongs to the server reviewer.
- **ADR-0008, sign-in "от имени" not implemented.** The UI banner and `canWrite` paths stay dormant.
- **ADR-0018, permissions checked on the server only.** Matches: UI gates are cosmetic (`AppShell.tsx:20-24`).

## 5. Questions for the architect

1. Should a test or prod build hard-fail when `NEXT_PUBLIC_API_MOCKS` is set, and should `stack build` always skip the Nx cache (F1)?
2. Should a server-side 401 lock the POS at once, so that a paused outbox blocks sales (F2)?
3. Should signing out during an outage lock the terminal locally (F3)?
4. What happens to the IndexedDB of an unbound browser (F4)? Should it be purged automatically, and who reviews quarantined operations that can no longer be sent?
5. Is E17 accepted as protection against casual viewing only? The alternative is to wrap the key with a secret the server gives per session.
6. Should the API refuse an empty ПКУ record for online sales, given that the dialog's requirement can be bypassed (K3)?
7. Should expenses and operator billing changes carry Idempotency-Key (F8)?
