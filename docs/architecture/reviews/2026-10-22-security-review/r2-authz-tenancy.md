# R2 — Authorization and multi-tenant isolation (main 80c4973)

Reviewer area: guard chain, store scope / IDOR, privilege escalation, RLS and DB roles, platform contour,
SECURITY DEFINER functions, sync contour, backup role. Prefix Z. Read-only; no secrets opened.

## 1. Scope covered

- ADR-0002, ADR-0008 (amendments 2026-10-05, 2026-10-21), ADR-0013 (all amendments), ADR-0014, ADR-0018, ADR-0019;
  spec 2026-10-21-pos-offline-limits (P9–P11, У7), 2026-10-13-pos-shift-sale (K7, E3, E7); data-model/01 (operators).
- Guards and context: `app.module.ts`, `common/guards/*`, `common/http/contour.ts`, `session.middleware.ts`,
  `request-context.ts`, `auth/permissions.guard.ts`, `session-issuer.ts`, `principal-loader.ts`,
  `operator-permissions.guard.ts`, `libs/shared/domain` permissions, operator permissions, role templates.
- All 67 controllers (scripted scan of route markers); services of staff, terminals, stores, pricing, suppliers,
  pos, audit, sync; inventory, reports, returns, notifications, billing and platform/** traced by delegated reads.
- DB: all 47 migrations (RLS, policies, grants, FKs, SECURITY DEFINER), `table-classes.ts`, `tenant-database.ts`,
  `platform-database.ts`, `context-resolvers.ts`, `docker/postgres/initdb/*`, `docker/compose*.yml`,
  `apps/api/eslint.config.mjs`, `scripts/issue-license-key.mjs`.

## 2. Findings

### Z1 — Medium — A backdated shift opening under the terminal escapes the "current shift" bound of P10
- **Location:** `apps/api/src/app/pos/shifts.service.ts:126`, `:141`; `apps/api/src/app/pos/pos-context.ts:71-87`, `:255-264`.
- **Evidence:** the opening passes no shift (`this.context.operation(body, 'shifts:create', sentAt)`), so
  `requireHolder` gets floor `null`; `boundedMoment` then accepts any moment up to `HORIZON_MS = 30 days` back, and
  `openedAt = operationMoment(op, null)`.
- **Attack:** a person at the POS browser of a bound terminal (device cookie only, no session; or a cashier with any
  PIN session there; or XSS in the web origin, which rides the HttpOnly cookie) while the terminal has no open shift:
  `POST /api/v1/shifts` with `employeeId` = anyone who PIN-signed in on this terminal in the last 30 days (a
  manager, the owner) and `occurredAt` shortly after that sign-in. The holder check passes, the shift is recorded as
  opened by that person on a past business date. All later operations of the shift are floored at that
  `openedAt`, so cash-outs, sales and the closure can be attributed to the same person at the same past moments.
  None of them is flagged, because the person is active and the moment is more than 60 s old. ADR-0008 (amendment
  2026-10-21 p.2) and У7 promise that "only someone who held the terminal in the current shift can be named". For
  an opening, that is not true.
- **Recommendation:** for an opening, floor the moment at the `closed_at` of the terminal's previous shift (and at
  the time it was bound). For terminal-mode openings, also consider capping the horizon at the network buffer limit
  instead of 30 days.
- **Confidence:** confirmed (traced in code).

### Z2 — Low — The owner's audit journal does not show that an operation was sent "under the terminal"
- **Location:** `apps/api/src/app/audit/audit-journal.ts:157-215`; written at `apps/api/src/app/pos/pos-context.ts:61-68`.
- **Evidence:** `project()` returns `employeeName`, `storeName`, `params` and `byOperator`. It never returns
  `details.via` or `terminal_id`.
- **Scenario:** an operation sent under the terminal on behalf of a past holder (accepted risk, plus Z1) looks
  exactly like the author's own operation in the journal. ADR-0008 (amendment 2026-10-21 p.4) relies on "operations
  are visible in the audit with the terminal" as the mitigation. That mitigation exists only in the database, not in
  the product.
- **Recommendation:** expose `via: 'terminal'` and the terminal name in `TenantAuditEntry`, and show the `author`
  flags next to them.
- **Confidence:** confirmed.

### Z3 — Low — Service-level 403 refusals are not written to `audit_log` as `access.denied`
- **Location:** `apps/api/src/app/inventory/store-access.ts:28`; `pricing/prices.service.ts:58,120,146`;
  `pricing/discount-rules.service.ts:133,140`; `purchasing/purchase-orders.service.ts:269,281` (and the other
  services using `store_not_in_scope`). The interceptor `AccessDeniedAudit` is attached only to
  `staff/employees.controller.ts:33` and `staff/roles.controller.ts:20`.
- **Evidence:** `throw new ProblemException(403, 'store_not_in_scope')` is thrown without an audit write. The
  guard (`permissions.guard.ts:143-161`) audits only route-permission and decorator-scope refusals, and almost no
  route declares a scope option.
- **Scenario:** an employee probing other stores' documents (each probe gets 403 `store_not_in_scope`), or using a
  missing special right such as `pricing:update-store`, leaves no trace. ADR-0018 p.9 requires these refusals,
  with the permission and the store, to be audit events.
- **Recommendation:** register `AccessDeniedAudit` globally (`APP_INTERCEPTOR`) for tenant routes, or make
  `StoreAccess.inScope` and the special-permission checks append the event.
- **Confidence:** confirmed.

### Z4 — Low — The supplier card and list expose network-wide debt and ledger to store-scoped staff
- **Location:** `apps/api/src/app/purchasing/suppliers.service.ts:217`, `:228` (card); `:158-170` (list);
  `purchasing.repository.ts:241-256`.
- **Evidence:** in the card, `receipts` is filtered by scope (`:220`), but `...debtOf(supplier, receipts, today, true)`
  and `ledger: await this.ledger(trx, tenantId, supplierId)` are computed over all stores.
- **Scenario:** a store manager (template: store scope, `purchasing:view` + `finance:view-cost`) opens a supplier
  card. They see the debt, overdue amount and every ledger line (document numbers, purchase amounts, payment
  comments) of stores outside their scope. The code shows the intent to filter: the same card's receipt list and
  orders are scoped.
- **Recommendation:** filter ledger entries by the document's store, or decide explicitly that supplier debt is
  network-level information (see Q4).
- **Confidence:** confirmed.

### Z5 — Low — The sync contour is live in the cloud with no keys and loads the 2-connection resolver pool before authentication
- **Location:** `apps/api/src/app/app.module.ts:176-179`; `apps/api/src/app/sync/license-key.guard.ts:43`;
  `apps/api/src/core/database/context-resolvers.ts:53`.
- **Evidence:** every well-formed `Bearer phk_<16 hex>_<43>` header runs `resolve_license_key` on the resolver pool
  (`RESOLVER_POOL_MAX = 2`). That pool is shared with password sign-in (`resolve_login`) and PIN sign-in
  (`resolve_terminal`). The throttle is per IP, 300/min.
- **Scenario:** a distributed flood of `/api/v1/sync/runs` requests from many IPs queues the resolver pool, and
  sign-ins of every network wait or time out. The pilot has no offline stores, so this surface brings no benefit.
- **Recommendation:** register `SyncModule` only behind an explicit env flag (off for the pilot), or give the
  license-key resolver its own pool.
- **Confidence:** needs runtime check (load behaviour).

### Z6 — Low — `pharmacy_backup` (BYPASSRLS, `pg_read_all_data`) can log in from any container on the compose network
- **Location:** `docker/postgres/initdb/04-backup-role.sql:13-19`; `docker/compose.backup.yml:11`, `:25-26`;
  `docker/postgres/Dockerfile` (no custom `pg_hba.conf`).
- **Evidence:** `alter role pharmacy_backup with login … bypassrls connection limit 2 password %L`. No
  `pg_hba` rule restricts the role to the backup service; the official image's default is
  `host all all all scram-sha-256`. The password also sits in the environment of the long-lived `postgres`
  container.
- **Scenario:** whoever obtains the password can read every tenant's data, credential hashes and license-key
  hashes from any container on the network, bypassing RLS. Examples: an `api` RCE combined with a leaked env file,
  `docker inspect` of `postgres`, or a server log with `log_statement=ddl`. Today `api` does not receive the
  password (`compose.yml:54-76`), which limits the risk.
- **Recommendation:** add a `pg_hba` line that rejects `pharmacy_backup` except from the backup service (or a
  dedicated network), and pass the password to `postgres` only for the `04-backup-role.sql` run, not as a
  permanent variable.
- **Confidence:** likely (default image `pg_hba` behaviour, not in the repo).

### Z7 — Info — Lookups and idempotent replays happen before the authorization check
- **Location:**
  - `inventory/opening-balance-import.service.ts:128-135`: replay before `writableStore`;
  - `pos/held-receipts.service.ts:58-59`: an existing held receipt is returned by id, with its lines, before any
    store check;
  - `inventory/transfers.service.ts:125-127`: another store's request is locked and its state disclosed (409)
    before the scope check;
  - POS and returns idempotent replays before `PosContext.operation`.
- **Scenario:** each needs a UUIDv7 of another store's object (replays also an identical body); impact negligible.
- **Recommendation:** move the scope check ahead of the replay or lookup.
- **Confidence:** confirmed.

### Z8 — Info — Notifications without a store reach store-scoped employees
- **Location:** `apps/api/src/app/notifications/notifications.repository.ts:225`.
- **Evidence:** `(n.store_id is null or n.store_id = any(...))`.
- **Scenario:** `service_decided` and `invoice_overdue` (with amounts) reach a store manager who holds
  `notifications:view`. This contradicts the comment "for the network scope only" in `notifications.service.ts:63-65`.
- **Recommendation:** decide (Q7), then filter `store_id is null` for non-network scopes.
- **Confidence:** confirmed.

### Z9 — Info — The tenant role can read the `key_hash` column of its own license keys
- **Location:** `apps/api/migrations/1792144500972_sync-receive.sql`: `grant select on pharmacy.license_keys to pharmacy_app`.
- **Scenario:** no tenant route reads `license_keys` today; a future query bug could expose the (non-reversible) hashes.
- **Recommendation:** grant only the columns the owner cabinet needs.
- **Confidence:** confirmed.

### Z10 — Info — Operators can broadcast to every tenant without step-up
- **Location:** `apps/api/src/app/platform/notifications/announcements.controller.ts:28-32` (`platform:manage`, no
  `@RequireFreshAuth`).
- **Scenario:** a stolen operator session publishes a phishing announcement to every user of every network.
- **Recommendation:** add `@RequireFreshAuth()` to create.
- **Confidence:** confirmed.

## 3. Controls verified

**Guard chain**
- Global guard order (Auth → CSRF → throttle → Permissions → OperatorPermissions → FreshAuth): `app/app.module.ts:190-195`.
- Deny by default, resolved at the nearest level: `common/guards/route-access.ts:74-82`. Unmarked tenant route: `app/auth/permissions.guard.ts:125-126`. Unmarked operator route: `platform/auth/operator-permissions.guard.ts:66-73`; every denial is audited (`:85-116`, `permissions.guard.ts:143-161`).
- Route markers, scanned for all 57 tenant controllers:
  - every route has `@RequirePermission`, `@Authenticated` or `@Public`;
  - `@Public` appears only on health, deployment, `POST activations`, `POST sessions`, `POST terminal-sessions`, `GET terminals/current` and `sync/*` (`@UseGuards(LicenseKeyGuard)`, `sync-receive.controller.ts:37-38`);
  - routes declared with `*:view` but writing data are gated in the service: `prices.service.ts:118-121`, `discount-rules.service.ts:127-141`.
- Contours:
  - chosen by path, case-insensitive; absolute-form URLs get the strictest contour: `common/http/contour.ts:15-18`;
  - only the matching cookie or token is read: `session.middleware.ts:144-146`, `:184` (`aud 'web'`);
  - `getPrincipal`/`getOperator` are kind-checked: `request-context.ts:86-106`.

**Store scope and IDOR**
- Store scope from the decorator: `permissions.guard.ts:65-74`, `:134-139`.
- A PIN session's scope is exactly the terminal store: `auth/session-issuer.ts:104-106`, `session.middleware.ts:90-102`.
- Store selection is checked against the active stores in scope: `auth/sessions.service.ts:190-198`.
- Inventory:
  - shared helper `inventory/store-access.ts:25-52`;
  - all 59 routes check the scope before any read or write, and a document cannot move between stores on edit
    (delegated trace, e.g. `stock-documents.service.ts:391,429,432`, `transfers.service.ts:290,459`);
  - batches of another store are reported as `unknown_batch`.
- POS, returns, reports, expenses, audit journal and purchase orders are scoped:
  - POS: `pos/pos-context.ts:150-155`, `:227-235`;
  - reports: `reports/scope.ts`;
  - audit journal: `audit-journal.repository.ts:131-133`;
  - expenses: `reports/expenses.service.ts:164-165` (both the old and the new store);
  - purchase orders: `purchase-orders.service.ts:298`.
- Terminals: binding checks the store in the decorator (`terminals.controller` `storeBody`); revocation checks the scope (`terminals/terminals.service.ts:207-213`); PIN sign-in requires store access (`terminal-sessions.service.ts:111`).
- Cost fields are omitted without `finance:view-cost` across stock, documents, reports, purchase orders, store closing and the journal (e.g. `stock.service.ts:196-198`, `store-closing.service.ts:54-70`).

**Escalation**
- Only an owner can assign or touch the Owner role; a role never exceeds the editor: `staff/assignment-rules.ts:46-49`.
- Employees:
  - own assignment refused: `employees.service.ts:190-191`, `:406`;
  - `employees:assign-role` required to change role or scope: `:193-195`;
  - role and scope must fit within the editor's: `:331-345`, `:383-388`;
  - peer rule: `:389-394`;
  - last active owner protected: `:202-209`, `:292-298`.
- Roles:
  - the system role is immutable: `roles.service.ts:92`;
  - an editor cannot edit their own role: `:95`;
  - both the old and the new permission set must fit the editor: `:98-103`;
  - only catalog strings are accepted: `:135-143`.
- Permission changes apply on the next request through the version check (`session.middleware.ts:222-254`). Blocking an employee ends their sessions (`employees.service.ts:313`).

**Database isolation**
- ENABLE and FORCE RLS on every tenant, tenant-export and platform table (69 of 69; the shared `services` and `platform_settings` tables have no tenant rows).
- 66 `tenant_isolation` policies, all `TO pharmacy_app`, with USING and WITH CHECK on `current_setting('app.tenant_id')::uuid` without `missing_ok`; no `TO public` policy.
- The two temporary `no force` steps are restored within the same migration: `1791956981070_owner-cabinet.sql:90-102`, `1792150729010_audit-entity-index-return-keys.sql:33-45`.
- Every foreign key into a tenant table is composite `(tenant_id, …)`; a grep found no single-column FK into tenant data.
- The tenant context is transaction-local (`set_config(..., true)`) as the first statement, and the tenant id is UUID-checked: `core/database/tenant-database.ts:55-63`.
- Platform actor is validated and transaction-local: `platform-database.ts:25-34`, `:69-75`.
- Resolvers send fixed SQL only, with bound parameters: `context-resolvers.ts:41-50`.
- No unsafe raw SQL anywhere: every `sql.raw`/`sql.lit`/`sql.ref` takes constants (delegated sweep, e.g. `documents.repository.ts:28-36`, `stock-alerts.ts:49`).
- SECURITY DEFINER functions:
  - all use `search_path = ''`, are owned by `pharmacy_resolver`/`pharmacy_provisioner`, revoke PUBLIC and grant EXECUTE only to app or platform: `1790934768191:27-54`, `1791182068273:13-23`, `1792144500972:172-186`, `1791372899143:223-316`, `1791268123917`;
  - superseded overloads are dropped (`1791259544515:6`, `1791349873783:7`, `1791372899143:213`);
  - default `revoke execute … from public` (`initdb/02-database.sql`).
- `PlatformDatabase` imports are limited to `platform/**` and `sync/**` by ESLint (`apps/api/eslint.config.mjs:12-35`). `pharmacy_platform` has only column grants on `stores`.
- Operator routes return no raw tenant data. Tenant recomputation runs through ports that return `void`, in the tenant's own context: `billing/store-usage.ts:23-30`, `pos/store-sales-export.ts:25-36`.

**Sync contour**
- License key:
  - SHA-256 of a 32-byte secret, compared in constant time even for an unknown key: `sync/license-key.guard.ts:43-49`;
  - key generation: `scripts/issue-license-key.mjs:67-69`;
  - `revoked_hard` gets 401: `:56`; a body store that differs from the key gets 403: `:59-61`.
- Store and scope binding:
  - operations from an online store are refused: `sync-apply.service.ts:70`;
  - the feed is closed unless the key is active or expiring: `sync-feed.service.ts:14`, `:63`;
  - the feed is scoped to the key's store: `:190`;
  - a run of another store gets 404: `sync-runs.service.ts:75`;
  - appliers take the store from the key, `sameStore` (e.g. `transfer-facts.ts:73`, `audit-facts.ts:34-35`).
- P10 reads only cloud sign-ins, so offline-injected `auth.pin-succeeded` rows cannot make someone a holder: `audit/pin-sign-ins.ts:30-31`.

**Buffered POS**
- A terminal-mode request requires a non-revoked device cookie of an active network, and the session tenant must equal the device tenant: `pos/buffer-replay.interceptor.ts:47-64`.

**Backup role**
- The password is passed only to `postgres` and `backup`, never to `api`: `docker/compose.backup.yml:11`, `:26`; `docker/compose.yml:54-76`.

## 4. Accepted limitations touched

- ADR-0008 amendment 2026-10-21 p.1–4 (buffered operations under the terminal; the holder is the last PIN sign-in, so a holder after sign-out or another cashier's session can be named; author rights mark the operation instead of refusing it): the code matches, except the bound promised for openings (Z1) and the audit visibility the ADR relies on (Z2).
- POS spec K7/E3/E7 (an author without `pos:sell-controlled`/`pos:choose-batch`, blocked or out of scope is marked, not refused, also online): matches (`receipts.service.ts:249-255`, `pos-context.ts:302-314`).
- ADR-0008 amendment 2026-10-05 p.7 (an owner code issued by an operator replaces the owner's password; callback procedure, two audits): matches; it is the operator → tenant takeover path, controlled only by procedure.
- data-model/01, 2026-10-14 (an operator can reissue a code to another active operator and sign in as them; a single `full_access` role): matches.
- ADR-0013 amendments 2026-10-15, 2026-10-19, 2026-10-21 (operator requests or a timer trigger per-tenant recomputation and purge through ports): matches.
- ADR-0018 amendment 2026-10-13 p.3 (`roles:manage` edits roles used outside the editor's scope): matches.
- ADR-0019 (`pharmacy_backup` is the only BYPASSRLS runtime role; backups are unencrypted on the host until hosting is decided): matches; see Z6.
- ADR-0014 / spec offline-sync E10–E15 (the store is trusted for its own facts and employee ids; a revoked key accepts operations during the grace days; `--hard` is for stolen PCs): matches.
- Network-level data by spec (catalog, suppliers and supplier payments, legal entities, settings, billing, announcements, the store list in the transfers overview): matches.

## 5. Questions for the architect

1. Z1: floor a terminal-mode shift opening at the terminal's last closing (and cap it at the buffer limit)?
2. Should a PIN sign-out (`DELETE /sessions/current`) end the terminal "hold" of P10? Today the last sign-in holds the terminal for up to `pos_buffer_max_hours`.
3. `pricing:update-network`, `discounts:manage-network`, `catalog:*` and `purchasing:post` act on stores outside the editor's scope, and the store-scoped Manager template holds network-wide catalog, supplier and payment rights. Is that intended under ADR-0018 p.5?
4. Supplier debt and ledger: network-level information for store managers, or scope-filtered (Z4)?
5. Keep `/api/v1/sync/*` registered in the pilot, or put it behind a flag until the first offline store (Z5)?
6. Restrict `pharmacy_backup` in `pg_hba` to the backup service (Z6)?
7. Should store-less notifications (service decisions, overdue invoices with amounts) reach store-scoped employees (Z8)?
