# R1 — Authentication and sessions (prefix A)

Reviewer area: authentication and sessions. Baseline: ADR-0008 with amendments 2026-10-02, 10-05, 10-06, 10-21; spec
`docs/superpowers/specs/2026-10-02-auth-design.md` (§6–§9) and `2026-10-06-staff-design.md` §5. Code at main 80c4973.

## 1. Scope covered

- `apps/api/src/core/crypto/*` (password-hasher, key-ring, session-token.service, self-check, tokens, crypto.module)
- `apps/api/src/core/sessions/*` (session-store, redis-session-store, operator-session-store, sessions.module; pg store skimmed)
- `apps/api/src/core/redis/*`, `apps/api/src/app/config/env.validation.ts`, `apps/api/src/main.ts`, `app.module.ts`
- `apps/api/src/common/{guards,middleware,http,throttling,validation}` (csrf, auth, fresh-auth, route-access, buffer-replay,
  session/correlation middleware, token-extractor, contour, principal throttler, Redis throttler storage, validation pipe)
- `apps/api/src/app/auth/*` (sessions, activations, me, login limiter, clock, identifier, issuer, cookies, permissions-version)
- `apps/api/src/app/terminals/*` (PIN sign-in, binding, revocation), `apps/api/src/app/staff/employees.service.ts` (reset, PIN,
  block), `apps/api/src/app/pos/buffer-replay.interceptor.ts`
- `apps/api/src/app/platform/auth/*`, `platform/operators/operators.controller.ts`, `platform/tenants/tenants.{controller,service}.ts`
- `apps/api/scripts/create-activation-code.mjs`, `create-operator.mjs`, `generate-store-secrets.mjs`
- `apps/web/src/shared/api/{client,fresh-auth}.ts`, auth features/pages, `apps/web/sw/sw.template.js`, `apps/admin/src/shared/api/client.ts`
- `docker/env/*.env.example`, `docker/compose.yml` (auth variables only), `libs/shared/domain` password/PIN policy

## 2. Findings

### A1 — Medium — Operator accounts are single-factor, yet one operator session can take over any tenant
- **Location:** `apps/api/src/app/platform/auth/operator-sessions.service.ts:142-149`;
  `platform/auth/operator-session-resolver.ts:55`; `platform/tenants/tenants.controller.ts:66-67`;
  `platform/operators/operators.controller.ts:43-44`
- **Evidence:** operator sign-in is e-mail + password only; every operator gets `role: 'full_access'`, which includes
  `POST /operator/tenants/:id/owner-activation-codes` and `POST /operator/operators/:id/activation-codes`.
- **Scenario:** an operator's password is phished or reused from a breach. The attacker signs in at the internet-facing
  admin origin (fresh session satisfies `@RequireFreshAuth`), issues a new owner code for a pharmacy chain, activates it
  (`POST /activations`) and owns the chain: all sales, stock, employees, customer prescription data. The owner sees an
  audit line afterwards; the callback procedure (ADR amendment 2026-10-05 p. 7) is organisational and not enforced by
  code. The same applies to taking over a peer operator. The only technical barrier is the per-e-mail lockout
  (~120 guesses/day) and an 8-character policy.
- **Recommendation:** for the pilot, restrict `ADMIN_ORIGIN` and `/api/v1/operator/*` at the reverse proxy to the operators'
  IPs or a VPN (no code change). Then, via ADR, add a second factor for operators (TOTP over `node:crypto` HMAC is
  RFC 6238, no new library) or at least require two operators for owner-code issue.
- **Confidence:** confirmed.

### A2 — Medium — Online password guessing budget is per identifier string, multiplied per account
- **Location:** `apps/api/src/app/auth/login-limiter.ts:31-33`; `sessions.service.ts:153`, `:228`;
  `me.service.ts:106`; `libs/shared/domain/src/lib/password-policy.ts:5-15`
- **Evidence:** `return \`${kind}:${sha256Hex(value)}\`` — the lock key is the normalized login, phone or e-mail, so
  one employee has three independent counters; re-confirmation (`reconfirm:<tid>:<eid>`) and password change
  (`password-change:<tid>:<eid>`) have their own. The policy (≥8 chars, one upper-case letter, one digit) accepts
  `Password1`, `Apteka2026`.
- **Scenario:** an internet attacker knows a pharmacy owner's phone (public on signage) and login or e-mail. With
  5 attempts → 15 min lock, then 1 h locks for 24 h, each identifier yields ~120 guesses/day; three identifiers give
  ~350/day from rotating IPs (the 60/min/IP throttle does not bind a distributed attacker). A top-10 000 list of
  policy-compliant passwords is exhausted in about a month; nothing alerts the owner (failures are only in `audit_log`).
- **Recommendation:** after `resolve_login` succeeds, reserve a second attempt on an account key
  (`account:<tid>:<eid>`, same Lua script) with a daily cap; count reconfirm/password-change failures in that key
  too; add a local deny-list of common passwords to `passwordProblems`. Surface lock events to the owner (notification
  counter already exists). Trade-off to decide: an account key makes lock-out DoS easier (question 2).
- **Confidence:** confirmed (matches spec §6 step 3; the multiplication is not discussed there).

### A3 — Medium — Unauthenticated clients can force 10 MB (gzip-inflated) JSON parsing before any guard
- **Location:** `apps/api/src/main.ts:37-50`; `apps/api/src/common/http/contour.ts:39-43`
- **Evidence:** the import parser is selected by `hasSessionCookie(req.headers.cookie)`, which only tests
  `/(?:^|;\s*)(?:__Host-sid|sid)=/` — any value. body-parser inflates `Content-Encoding: gzip` by default and the
  10 MB limit applies to the inflated body.
- **Scenario:** a client with no account sends `POST /api/v1/catalog-imports` with `Cookie: sid=x`,
  `Content-Type: application/json`, `Content-Encoding: gzip` and a ~10 KB gzip of 10 MB of JSON. Inflation (libuv pool)
  and `JSON.parse` (event loop, tens of ms) run before `AuthGuard`, `CsrfGuard` and the throttler (the throttler counts
  the request only after the parse). A few dozen such requests per second from one host stall the whole API —
  sign-in, PIN switching and POS receipts of every pilot chain. The sync contour (`main.ts:24-36`, 2 MB inflated, no
  cookie gate) has the same shape; flagged for the sync reviewer.
- **Recommendation:** set `inflate: false` on the import parser (the web client never compresses uploads); gate it on
  a verified token (a small middleware calling `SessionTokenService.verify`, HMAC only) or move large-body parsing into
  the import controllers after guards; cap request bodies per path at Caddy.
- **Confidence:** likely (code path confirmed; CPU cost per request needs a runtime check).

### A4 — Low — scrypt capacity and the failure floor are not calibrated for the target VPS
- **Location:** `apps/api/src/core/crypto/password-hasher.ts:15-20`; `app/config/env.validation.ts:184`;
  `app/auth/sessions.service.ts:147`; no `UV_THREADPOOL_SIZE` in `apps/api/Dockerfile` or `docker/compose.yml`
- **Evidence:** `const P = 3;` (three sequential 32 MiB passes per check, ADR "Отрицательные"); default libuv pool of 4
  threads; every guest sign-in, including an identifier that does not normalize, runs a full scrypt (by design, for
  timing equality); `LOGIN_FAILURE_FLOOR_MS = 400`.
- **Scenario:** (a) ~20 guest sign-in requests/s from ~20 IPs keep all 4 pool threads busy; cashier PIN switching (also
  scrypt) and anything else on the pool queue behind them. (b) If one scrypt check on the Contabo vCPU takes longer than
  400 ms, the floor never pads and the remaining difference between unknown and known identifiers (two extra DB
  transactions) becomes measurable with enough samples.
- **Recommendation:** measure scrypt p50/p99 on the VPS (ADR already asks for it); set `UV_THREADPOOL_SIZE` (e.g. 8–16)
  in compose; set `LOGIN_FAILURE_FLOOR_MS` above the p99 of the failing path.
- **Confidence:** needs runtime check.

### A5 — Low — API responses carry no `Cache-Control: no-store`
- **Location:** `apps/api/src/main.ts:61` (helmet defaults; no Cache-Control anywhere in `apps/api/src`)
- **Evidence:** `app.use(helmet());` — helmet does not set Cache-Control; Express adds an ETag to JSON.
- **Scenario:** on a shared pharmacy PC, authenticated JSON (session profile, employee cards with phones, prescription
  data in receipts) may be written to the browser's disk cache and remain after sign-out or a PIN switch.
- **Recommendation:** one middleware in `main.ts` (or a Caddy header for `/api/*`) setting `Cache-Control: no-store`.
- **Confidence:** likely.

### A6 — Info — URL-encoded body parser is enabled though no route accepts forms
- **Location:** `apps/api/src/main.ts:52`
- **Evidence:** `app.useBodyParser('urlencoded', { extended: true });`
- **Scenario:** no exploit (CsrfGuard rejects non-JSON unsafe requests), but every form body is parsed with `qs`
  before the guard — extra pre-auth parser surface.
- **Recommendation:** remove the line.
- **Confidence:** confirmed.

### A7 — Info — `APP_ENV=prod` start-up accepts `http://` origins and `TRUST_PROXY=0`
- **Location:** `apps/api/src/app/config/env.validation.ts:27`, `:232`, `:311-323`
- **Evidence:** `ORIGIN = /^https?:\/\/[^\s/?#]+$/`; `TRUST_PROXY = 0` default; the prod block checks only dev keys.
- **Scenario:** a prod env file left with `TRUST_PROXY` commented out (as in `prod.env.example`) puts every guest behind
  Caddy into one 60/min bucket: one client sending 61 sign-in requests per minute blocks all sign-ins and PIN logins
  of all chains.
- **Recommendation:** with `APP_ENV=prod`, refuse `http://` origins and `TRUST_PROXY=0` (fail fast like the dev-key check).
- **Confidence:** confirmed.

### A8 — Info — Session cookies are persistent (Max-Age = 12 h), not browser-session cookies
- **Location:** `apps/api/src/app/auth/session-cookie.ts:55`, `:80`; `session-issuer.ts:146`
- **Evidence:** `maxAge: maxAgeSeconds * 1000` with the absolute lifetime.
- **Scenario:** a manager signs in on a cashier PC and closes the browser; the next person who opens it within the
  network's idle timeout continues the manager's session. Server-side idle timeout still bounds it.
- **Recommendation:** omit `maxAge` for `__Host-sid` / `__Host-op_sid` (the JWT `exp` and Redis TTL keep the limit).
- **Confidence:** confirmed.

### A9 — Info — Globally unique identifiers give tenants a cross-tenant existence oracle
- **Location:** `apps/api/src/app/staff/employees.service.ts:50-53`
- **Evidence:** `employees_phone_global_uq: { code: 'phone_taken', field: 'phone' }`.
- **Scenario:** a manager of chain A with `employees:manage` learns whether a phone, e-mail or login is registered
  anywhere on the platform (e.g. a competitor's owner) from 409 `phone_taken`; the same identifiers are sign-in names.
- **Recommendation:** accept as a documented consequence of amendment 2026-10-02 p. 2, or answer 409 without the field
  for identifiers owned by another tenant.
- **Confidence:** confirmed.

## 3. Controls verified

- scrypt `N=2^15, r=8, p=3`, keylen 32, salt 16 B, `maxmem` 64 MiB = 128·N·r·2 — `core/crypto/password-hasher.ts:15-20`
- HMAC-SHA-256(pepper) before scrypt, pepper version stored and checked — `password-hasher.ts:185-187`, `:130`
- Constant-time compare with length check — `password-hasher.ts:140-143`
- Parameters read from stored PHC are bounded (no memory DoS from a bad row) — `password-hasher.ts:23-25`, `:66`
- Dummy hash for unknown login, missing hash, corrupt PHC, retired pepper — `password-hasher.ts:130-133`; `app/auth/sessions.service.ts:147`, `:165`, `:370`, `:379`
- `needsRehash` on parameter or pepper change, rehash guarded by compare-and-set — `password-hasher.ts:155-166`; `employee-auth.repository.ts:135`
- RFC 7914 self-check runs before the hasher exists — `core/crypto/crypto.module.ts:18`; `self-check.ts:21`
- Key rings: ≥32 bytes per key, active id must exist, pepper ids integers, prod refuses `.env.example` keys, rings print redacted, raw lists replaced — `key-ring.ts:48`, `:91`; `env.validation.ts:311-323`, `:348`
- JWT: HS256 pinned, issuer and audience enforced, key chosen by `kid` from the ring — `session-token.service.ts:136`, `:167`
- Audience separation: web token must carry `tid`, admin token must not — `session-token.service.ts:111`, `:145-146`
- Server record checked on every request; record must match `jti`/`tid`/`sub` — `common/middleware/session.middleware.ts:184-199`; `core/sessions/redis-session-store.ts:177`
- Idle lifetime capped by absolute expiry; JWT `exp` = absolute TTL — `redis-session-store.ts:104-108`; `app/auth/session-issuer.ts:99`
- Employee block: version bump plus direct `destroyAllFor` — `app/staff/employees.service.ts:300`, `:313`
- Password reset/change/activation end other sessions; login/password-change race closed by row lock — `employees.service.ts:257`; `me.service.ts:192`; `activations.service.ts:147`; `sessions.service.ts` (`lockPasswordChange`)
- Tenant block flag ends sessions, verified against `tenants.status` — `session.middleware.ts:203-212`
- PIN session bound to the device cookie hash (constant-time) and terminal revocation flag — `session.middleware.ts:76-81`, `:213-220`
- Cookies `__Host-sid` / `__Host-op_sid` / `__Host-term`: Secure, HttpOnly, SameSite=Strict, Path=/ — `app/auth/session-cookie.ts:34`, `:39-42`; `device-cookie.ts:11-14`
- `AUTH_TEST_COOKIES` refused unless `APP_ENV=test`; boolean parsed from the raw string — `env.validation.ts:286`, `:39`
- CSRF on every unsafe method incl. `@Public`: `Sec-Fetch-Site` must be `same-origin`, else exact `Origin` per contour (missing/`null` rejected); JSON-only bodies — `common/guards/csrf.guard.ts:62-71`
- Contour chosen by path; absolute-form targets get the strictest contour; operator token never read on tenant paths — `common/http/contour.ts:15-17`; `session.middleware.ts:144`
- Token read from cookie only, own property, string — `common/middleware/token-extractor.ts:57-61`
- Login limiter: atomic Lua reservation before DB/hash, progressive lock, HMAC-keyed (no PII in Redis), same path for unknown identifiers — `app/auth/login-limiter.ts:52-73`, `:146`; `sessions.service.ts:153`
- One 401 for every failure, padded to floor + jitter (employee, operator, activation) — `sessions.service.ts:129`; `platform/auth/operator-sessions.service.ts:114`
- PIN: per-employee lock after 3 reserved before scrypt; per-terminal limiter; PIN only with a bound terminal — `terminals/terminals.repository.ts:61`; `terminal-sessions.service.ts:79`, `:119-123`
- Step-up is server-side: password session only, age ≤ `STEP_UP_MAX_AGE_SECONDS`, bounded clock skew; on terminals, staff, roles, own password/PIN, network settings, store closing and operator tenant/operator/billing actions — `common/guards/fresh-auth.guard.ts:44-50`
- Re-confirmation: password sessions only, limited, audited — `sessions.service.ts:223-228`
- Activation codes: 128 bits, SHA-256 stored, expiry and single use in one `UPDATE`, active employee and tenant required — `app/auth/activation-code.ts:9`, `:50`; `employee-auth.repository.ts:192-193`
- Session rotation at sign-in, PIN switch and password change; replaced session destroyed — `sessions.service.ts:117`; `terminal-sessions.service.ts:87`; `me.service.ts:192`
- Redis down fails closed: offline queue off, MULTI refused, session read errors → guest, limiter/throttler errors → 500 — `core/redis/redis.tokens.ts:15`, `:28`; `session.middleware.ts:147-153`
- No impersonation route, table use or admin button (grep of `apps/api/src`, `apps/admin/src`); operator status re-read per request — `platform/auth/operator-session-resolver.ts:36`
- Logs and errors carry error names only; validation errors drop values — `session.middleware.ts:149`; `common/validation/validation-pipe.ts` (`value: false`)
- Scripts print the code once, store SHA-256 only, write audit; store secrets never printed, mode 600, dev keys refused — `apps/api/scripts/create-activation-code.mjs:161`, `:208`; `generate-store-secrets.mjs:65`, `:97`
- Frontends: same-origin cookies only, no token in JS storage; Service Worker never touches `/api/` — `apps/web/src/shared/api/client.ts:84`; `apps/web/sw/sw.template.js:52`

## 4. Accepted limitations touched

- "Sign in as" not implemented; support via AnyDesk (amendment 2026-10-05) — code matches.
- New owner code makes the owner password replaceable; callback procedure — matches (fresh-auth operator route); procedure itself not enforceable in code (see A1).
- 4-digit PIN, lock after 3, colleague DoS — matches.
- Terminal lock: ADR row «Лимиты PIN» adds a manager notification; spec §8 dropped it and resets the counter on success — code matches the spec; no audit or notification on `terminal_locked`.
- Device cookie copyable with physical access; buffered POS operations under the terminal (amendment 2026-10-21) — matches (`common/guards/auth.guard.ts:30`, buffer-replay interceptor checks tenant).
- Privilege change updates the session snapshot in place without a new token — matches spec §7; differs from ADR row «Жизнь сессии» ("новый токен … при смене привилегий").
- Permission-version cache staleness up to 300 s — matches; blocking also destroys sessions directly.
- Keys and pepper in env files (stack.md q. 8) — matches.
- `TRUST_PROXY` must equal the proxy hop count (q. 13) — code supports it; default 0 (see A7).
- Progressive password lockout lets anyone who knows an identifier lock it out — inherent to ADR choice; matches.
- Operator step-up by re-confirmation "later" — operators must sign in again; matches.
- scrypt instead of Argon2id — matches.

## 5. Questions for the architect

1. Before the pilot: IP allowlist/VPN for the admin origin, and an ADR for an operator second factor or two-person owner-code issue?
2. Add an account-level attempt counter and a common-password deny-list, accepting easier lock-out DoS?
3. Rotate the session token on privilege change as ADR-0008 says, or amend the ADR to the spec §7 behaviour?
4. Restore the ADR's terminal-lock notification/audit, or amend the ADR to the spec?
5. Should `APP_ENV=prod` refuse `TRUST_PROXY=0` and `http://` origins at start-up?
6. Browser-session cookies (no Max-Age) for web and admin on shared PCs?
7. `Cache-Control: no-store` in the API or in Caddy?
8. Who calibrates scrypt time, `LOGIN_FAILURE_FLOOR_MS` and `UV_THREADPOOL_SIZE` on the Contabo VPS, and when?
