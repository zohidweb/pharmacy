# R3 — API input handling and attack surface (apps/api, libs/shared/dto)

Reviewer area: API input handling and attack surface. Main at 80c4973. Read-only review, nothing executed.

## 1. Scope covered

- Bootstrap and global wiring: `apps/api/src/main.ts`, `app/app.module.ts`, `app/config/env.validation.ts`
- Common layer: `common/validation/*`, `common/filters/problem-details.filter.ts`, `common/errors/*`, `common/http/contour.ts`,
  `common/guards/{auth,csrf}.guard.ts`, `common/guards/buffer-replay.ts`, `common/throttling/*`,
  `common/middleware/correlation-id.middleware.ts`
- All 45 DTO files under `apps/api/src/app/**/dto/` (scripted scan of every decorated property for string/array/number
  bounds plus a manual read of pos, returns, documents, purchasing, pricing, staff, sync, catalog-import);
  `libs/shared/dto/src/lib/*` (interfaces only, no class-validator)
- Every `@Body/@Query/@Param/@Headers` binding in controllers; every `sql.raw/ref/lit/val`, LIKE and `orderBy` site
- POS/financial logic: `pos/{receipts.service,receipt-pricing,pos-context,idempotency,buffer-replay.interceptor,pos-alerts}.ts`,
  `returns/returns.service.ts`, `inventory/posting.ts`, `platform/billing/payments.service.ts`, `pos/shifts.controller.ts`
- Imports: `core/imports/*`, `catalog/catalog-import.service.ts`, the three import controllers, data-import spec §F19/final review
- Sync contour: `sync/sync-receive.controller.ts`, `sync/license-key.guard.ts`, `sync/dto/sync.dto.ts`, `core/sync/checks.ts`
- DB timeouts: `core/database/{tenant-database,database-settings,unique-violation}.ts`
- Every `logger.*` call; health, deployment, fiscal, export-1c modules
- Lockfile versions (express 5.2.1, body-parser 2.3.0, class-validator 0.15.1); body-parser `lib/read.js`
- `apps/web/src/features/data-import/model/csv-out.ts` (formula injection only)

## 2. Findings

### I1 — Medium — Large JSON bodies are inflated and parsed before any authentication or throttling

- **Location**: `apps/api/src/main.ts:24-50`; `apps/api/src/common/http/contour.ts:39-43`;
  `apps/api/src/app/app.module.ts:190-192`; `node_modules/@nestjs/platform-express/node_modules/body-parser/lib/read.js:184-225`
- **Evidence**: the import parser (10 MB) runs when `hasSessionCookie(req.headers.cookie)`, which is a presence test
  only: `/(?:^|;\s*)(?:__Host-sid|sid)=/.test(cookieHeader)`. The sync parser (2 MB) needs only the path and
  `Content-Type: application/json`. body-parser keeps its default `inflate: true`, and `limit` applies to the
  decompressed stream (gzip, deflate, **br**).
- **Attack / failure scenario**: an anonymous internet client sends `POST /api/v1/catalog-imports/checks` with
  `Cookie: sid=x`, `Content-Encoding: br` and about 10 KB of brotli that inflates to 10 MB of JSON (for example
  `[{"a":0},…]`). Express inflates it and runs `JSON.parse` before the session middleware or any guard. The request
  then gets a 401 from `AuthGuard`. That guard runs before `PrincipalThrottlerGuard`, so an unauthenticated request
  is never counted and nothing limits the rate. The same works without a cookie on `/api/v1/sync/*` (2 MB): there
  the IP throttler counts the request only after the body is parsed. Tens of parallel requests can fill the heap
  and the event loop of the single API process. That stops the POS of every pilot network, and the frontends get
  500s or OOM restarts. The web client never compresses request bodies: `Content-Encoding` appears nowhere in
  apps/web.
- **Recommendation**: set `inflate: false` on the import parser, the default JSON parser and the urlencoded parser.
  Keep `inflate` only on the sync parser, and add a cheap pre-check to its `type` callback (the
  `licenseKeyIdOf(authorization) !== null` shape). Better still, parse the 10 MB import body in a Nest middleware
  that runs after `SessionMiddleware`, and only when a principal exists. Also cap the request body at the proxy
  (Caddy `request_body max_size`). If sync is not used in the pilot, see question Q7.
- **Confidence**: confirmed in code. The size of the impact (CPU and heap per request) needs a runtime check.

### I2 — Medium — The POS sale accepts any client unit price or discount percent; the server only adds a mark

- **Location**: `apps/api/src/app/pos/receipts.service.ts:119-125,178-192,239-240,265`;
  `apps/api/src/app/pos/receipt-pricing.ts:35-75`; `apps/api/src/app/pos/dto/pos.dto.ts:267-275,317-319,338-341`;
  `apps/api/src/app/pricing/pricing.repository.ts:195-207`; `apps/api/src/app/pos/pos-alerts.ts:59`
- **Evidence**: the receipt stores the client's price, `unitPriceDirams: line.unitPriceMinor`. A price different
  from the current one only adds `kinds.add('price')`. `discountPercent` (0–100) is client-chosen, and
  `ruleExists` accepts any rule id of the network, archived or out of period. `priceListVersion` is validated
  but never read anywhere in apps/api. The only discrepancy that raises an owner notification is `stock`. The
  price, discount and author marks are only counted on the shift page and the Z-report.
- **Attack / failure scenario**: a cashier on a cloud POS (an `online` receipt) opens DevTools and repeats
  `POST /api/v1/receipts` with `unitPriceMinor` halved, or with `discountPercent: 90` and any rule id. The
  arithmetic is self-consistent, so the server accepts it with code 201. The customer pays full price in cash and
  the cashier keeps the difference. Expected cash equals the receipt total, so the drawer reconciles. The only
  trace is a growing "with discrepancy" counter on the Z-report, with no notification. Spec K4/E5 accepts a
  *stale* price or discount (for offline staleness). The code accepts *any* value, also on receipts whose
  `origin` is `online`, so the code goes beyond the documented decision.
- **Recommendation**: accept a price that differs from the current one only if it equals the store's price at
  `priceListVersion`, using price history. Accept a discount only if it equals the rule's threshold percent for
  that subtotal. Otherwise refuse when `origin = online` and quarantine when the receipt comes from the buffer. In
  either case, raise an owner notification for `price`, `discount` and `author` marks (as `negative_stock` does)
  and add a report filter.
- **Confidence**: confirmed in code.

### I3 — Low — Costly endpoints share one flat limit; import checks have no concurrency cap

- **Location**: `apps/api/src/app/app.module.ts:61`; `apps/api/src/app/catalog/catalog-import.service.ts:64-73`
  (and the `check` methods of opening-balance and supplier imports); `apps/api/src/core/imports/import-jobs.ts:34,85`;
  `apps/api/src/app/config/env.validation.ts:76` (`DB_POOL_MAX = 10`)
- **Evidence**: there is one throttler of 300 requests per minute per principal, and `@Throttle` is used only on
  sign-in and activation routes. `ImportJobs.begin()` (at most 2 loads per process) is called in `apply` only.
  `check` validates up to 20,000 rows with class-validator on the event loop and holds a tenant transaction with
  no cap.
- **Attack / failure scenario**: a manager with `catalog:create` (or a stolen session) sends 10 parallel 10 MB
  checks or 366-day reports. These take all 10 tenant pool connections and block the event loop for seconds, so
  POS requests of every network time out (`connectionTimeoutMillis` 5 s gives 500s). A legitimate 20,000-row check
  also stalls the API for everyone while it validates. This is the same risk the final review gave as the reason
  for `imports_busy` (M5).
- **Recommendation**: apply `begin()` (or a second semaphore) to the checks too. Add per-route
  `@Throttle` on the import and check routes (for example 6 per minute) and on `/reports/:kind` (for example 30 per
  minute). Consider a separate small pool or a statement timeout for reports.
- **Confidence**: likely. The magnitude needs a runtime check.

### I4 — Low — API responses carrying personal and prescription data have no `Cache-Control: no-store`

- **Location**: there is no `Cache-Control` anywhere in apps/api/src (grep). Express 5 adds a weak `ETag` by default.
- **Evidence**: responses such as `/reports/controlled`, `/employees` and `/audit-log` are revalidatable cache
  entries.
- **Attack / failure scenario**: on a shared POS or office PC, the browser keeps these JSON responses in its disk
  cache after sign-out. The next local user, or malware, can read prescription and buyer data (ПКУ) from the
  profile.
- **Recommendation**: add a global middleware (or a Caddy header) that sets `Cache-Control: no-store` on `/api/*`.
- **Confidence**: needs a runtime check, because browser behaviour varies.

### I5 — Info — Some inputs reach the database malformed and answer 500 instead of 400

- **Location**: `apps/api/src/app/inventory/unposting-check.controller.ts:41`; `offset` in every list DTO (for example
  `inventory/dto/documents.dto.ts:55-59`); `pos/dto/pos.dto.ts:44-48` (`sinceVersion`); `sync/dto/sync.dto.ts:80-92,155-160`;
  `purchasing/purchase-orders.service.ts:442`
- **Evidence**: `KINDS[kind]` is a plain-object lookup, so `kind=constructor` returns `Object`, and that function
  goes into SQL as a parameter. Integer fields have `@Min(0)` but no `@Max`, so `offset=1e20` passes `IsInt` and
  overflows `bigint`. The purchase-order display total is summed in a JS number. At the DTO bounds (500 × 10⁵ ×
  10¹⁰) that exceeds 2⁵³, whereas posting already uses BigInt (`inventory/posting.ts:37-47`).
- **Attack / failure scenario**: an authenticated user gets a 500 and an error log entry. There is no injection,
  because no user string reaches `sql.raw`.
- **Recommendation**: use `Object.hasOwn(KINDS, kind)` or a `Map`; add `@Max` to offset, cursor and version fields
  (for example 10⁶, or `MAX_SAFE_INTEGER`); reuse `packsTotal` for the order total.
- **Confidence**: confirmed in code; the 500 outcome is likely.

### I6 — Info — A urlencoded parser (`extended: true`, qs) is parsed before authentication but no route can use it

- **Location**: `apps/api/src/main.ts:52`; `apps/api/src/common/guards/csrf.guard.ts:69-72`
- **Evidence**: `CsrfGuard` refuses every non-JSON unsafe request, yet the qs parser still runs on every form body
  first.
- **Attack / failure scenario**: it adds pre-authentication parsing surface (nesting up to depth 32, 1,000
  parameters) and gives no function.
- **Recommendation**: remove `app.useBodyParser('urlencoded', …)`.
- **Confidence**: confirmed.

### I7 — Info — One log line writes a full `error.stack`, including the error message

- **Location**: `apps/api/src/app/inventory/transfers.service.ts:326-329`
- **Evidence**: `error instanceof Error ? error.stack : String(error)`. Everywhere else the code logs only the name
  and code, and the exception filter strips the message line (`safeTrace`).
- **Attack / failure scenario**: a PostgreSQL error message (for example `22P02` "invalid input syntax … "value"")
  can put row values into the application log.
- **Recommendation**: log the name, the SQLSTATE and the correlation id, as `after-commit.ts:20` does.
- **Confidence**: confirmed.

### I8 — Info — The CSV helper does not neutralise formula prefixes

- **Location**: `apps/web/src/features/data-import/model/csv-out.ts:6-8`
- **Evidence**: cells are only quoted. The API accepts names that begin with `= + - @`.
- **Attack / failure scenario**: today the only CSV built from data is the import-issues file, where the stored
  name (`detail`) sits inside a fixed sentence, so it is not exploitable. The planned Excel and 1C exports (buttons
  disabled at the moment) would carry this risk.
- **Recommendation**: prefix a `'` to cells that begin with `= + - @ \t \r` in every future export.
- **Confidence**: confirmed.

## 3. Controls verified

- The global `ValidationPipe` sets `whitelist`, `forbidNonWhitelisted` and `transform`, and error objects carry no
  values or targets: `common/validation/validation-pipe.ts:51-55`. class-validator 0.15.1 defaults to
  `forbidUnknownValues=true` (`node_modules/class-validator/cjs/validation/ValidationExecutor.js:49`).
- Every `@Body`/`@Query` is bound to a runtime DTO class; no DTO is imported with `import type` (scan of all
  controllers).
- Every `:id` path parameter goes through `ParseUUIDPipe` or `uuid()`. The only exceptions are `kind`
  (`reports.service.ts:50` checks it against a list; for unposting-check see I5).
- Express 5 keeps its default "simple" query parser (no `query parser` override in main.ts or platform-express), so
  nested-object query injection is not possible.
- Body size limits: 100 KB by default, 2 MB on sync, 10 MB on imports: `main.ts:24-51`.
- `helmet()` is applied, `x-powered-by` is removed, and CORS is not enabled: `main.ts:61` (no `enableCors`).
- `trust proxy` is applied only from the validated `TRUST_PROXY` (0–5): `main.ts:58-59`, `env.validation.ts:226-232`.
- The RFC 7807 filter uses fixed titles and codes, never the framework message, and returns a generic 500. The log
  gets the name, SQLSTATE and stack frames only: `common/filters/problem-details.filter.ts:42,89-103,206-216`.
- `ProblemException.detail` is never built from input: no interpolated exception constructors (grep).
- CSRF: unsafe methods need `Sec-Fetch-Site: same-origin` or an exact Origin match, and a JSON content type:
  `common/guards/csrf.guard.ts:63-72`.
- A client correlation id is accepted only if it matches `^[A-Za-z0-9-]{8,64}$`, so it is safe to log and echo:
  `correlation-id.middleware.ts:8`.
- LIKE input escapes `\ % _`: `catalog/catalog.repository.ts:12-14`, `audit/audit-journal.repository.ts:41`,
  `platform/tenants/tenants.repository.ts:85-87`. Search terms are bounded at 100–200 characters.
- `sql.raw` and `sql.lit` take constants only: `inventory/documents.repository.ts:28-36`, `inventory/stock-alerts.ts:46-49`,
  `catalog/catalog.repository.ts:688`. Sort and direction values come from `IsIn` lists: `platform/tenants/dto/tenant.dto.ts:42-48`.
- The API has no `child_process`, file-system or outbound HTTP calls and no static file serving (grep in apps/api/src),
  so there is no SSRF or path-traversal surface.
- Money fields are integers in `[0 or 1, 10¹⁰]` (negative only for bank-terminal totals, E13). Line arrays are
  capped (receipt 200, documents 500, imports 20,000 or 2,000). The POS arithmetic stays below 2⁵³:
  `pos/dto/pos.dto.ts:37`, `pos/receipt-pricing.ts:35-75`.
- Document totals use BigInt and refuse anything beyond a safe integer: `inventory/posting.ts:37-47`.
- POS and return idempotency: the key equals the body id, the request hash is compared, and the key row is written
  first in the same transaction (`pos/idempotency.ts:60-112`). Billing and supplier payments use the client id as
  the key (`platform/billing/payments.service.ts:51-58`, `purchasing/payments.service.ts:30`).
- Returns cannot be refunded twice: a per-receipt advisory lock, quantity at most what is left, the refund
  recomputed on the server from the stored line, and each payment method capped at its paid remainder:
  `returns/returns.service.ts:122,157,209-246`.
- An expired batch is a hard refusal even under "sale is a fact": `pos/receipts.service.ts:155-157`.
- Every tenant transaction sets `statement_timeout` (5 s) and `lock_timeout` (2 s): `core/database/tenant-database.ts:56-59`.
  Report periods are capped at 366 days (`reports/reports.service.ts:23,65`) and the dashboard at 92
  (`reports/dashboard-period.ts:8`).
- Import `apply`: at most 2 per process, a per-tenant try-lock, a UUID idempotency key, and only counts in the
  log: `core/imports/import-jobs.ts:34,85-97,104-113,69-77,182-190`.
- The sync licence secret is compared as SHA-256 with `timingSafeEqual`, even when no key is found:
  `sync/license-key.guard.ts:44-49`.
- Password and login lengths are capped (128 and 254) to bound scrypt cost: `auth/dto/employee-login.dto.ts:6-16`,
  `shared-domain password-policy.ts:6`.
- `AUTH_TEST_COOKIES` is refused outside `APP_ENV=test`: `app/config/env.validation.ts:286-288`.
- Logs never contain request bodies, tokens or prescription data (name or code plus correlation id):
  `session.middleware.ts:150`, `sync-apply.service.ts:285-300`, `prescription-purge.scheduler.ts:98-117`,
  `import-jobs.ts:188`.
- Health returns `{status:'ok'}` only, and `/deployment` returns `{kind:'cloud'}`: `health/health.controller.ts:7-15`,
  `pos/deployment.controller.ts:8-14`.
- The fiscal and export-1c modules are empty (no controllers or providers): `fiscal/fiscal.module.ts`,
  `export-1c/export-1c.module.ts`.
- The API has no dev, mock or debug routes; mocks exist only in the web build (`NEXT_PUBLIC_API_MOCKS`).

## 4. Accepted limitations touched

- ADR-0015 / spec pos-shift-sale K4/E5 ("a sale is a fact": stock, price and discount differences become marks):
  matches for stock; for price and discount the code accepts arbitrary values, not just stale ones (I2).
- Spec E23 (`piecesPerPack` comes from the client snapshot and a mismatch adds a `catalog` mark): matches. The
  pieces deducted from the batch are computed from the client value (`receipts.service.ts:217-220`).
- K7 and offline-limits P9–P11 (operations sent "under the terminal"; the audit names the author with
  `via: 'terminal'`): matches. The employee of the session that actually sent the operation is not recorded.
- Spec E24 / customer-returns E13 (shift closing is a fact; bank-terminal totals may be negative): matches,
  `pos.dto.ts:118-133`.
- Data-import F19 and final review M7 (10 MB body only with a session cookie): matches, but it checks presence only
  (I1). M5 (two loads per process) matches for apply but not for checks (I3).
- ADR-0014 §6 (sync batch up to 2 MB after inflation): matches; it is parsed before the key is checked (I1).
- CLAUDE.md / ADR-0012 (`TRUST_PROXY` must equal the number of proxies hops): the code matches (default 0, validated
  0–5). If it is left at 0 behind Caddy, every guest shares one bucket of 60 sign-ins per minute.
- Integrations list (fiscal adapter as a stub, 1C out of the pilot): the modules are empty and expose no routes;
  matches.

## 5. Questions for the architect

- Q1: For `origin = online` receipts, should a unit price below the current store price (or a discount other than
  the best rule) be refused or need a manager's confirmation, instead of only being marked?
- Q2: Should `price`, `discount` and `author` marks raise an owner notification, like `negative_stock`?
- Q3: Cash-outs (`collection`, `expense`) need only `shifts:update`, have no amount limit and no second-person
  confirmation. Is that accepted for the pilot?
- Q4: Should the audit of an operation sent under the terminal also record the session employee who sent it (P11)?
- Q5: Will the Caddy configuration cap request body size and refuse `Content-Encoding` on non-sync API routes, or
  should the API drop `inflate` itself (I1)?
- Q6: Do you approve per-route throttles for imports, checks and reports, and a concurrency cap on checks (I3)?
- Q7: The pilot has no offline stores. Should `/api/v1/sync/*` be switched off with an environment flag in the
  pilot cloud build, removing an unauthenticated 2 MB parse surface?
