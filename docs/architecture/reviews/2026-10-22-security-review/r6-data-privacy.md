# R6 — Data protection, privacy and audit

Reviewer area: personal data inventory, minimisation, operator access, audit trail, ADR-0011 outbound data, data at
rest, exports/prints, deletion and retention, fixtures. Repository state: main 80c4973. Read-only review.

## 1. Scope covered

- Migrations: `org-foundation`, `auth-identity-audit`, `operators`, `offline-sessions`, `tenant-provisioning`,
  `issue-owner-code-pick-owner`, `pos-shifts-sales`, `pos-offline-limits`, `db-guards`, `inventory-core` (guards,
  partitions), `admin-stats`, `import-jobs`; column scan of all 47 migrations for personal-data columns.
- Data model `04-pos.md`, `06-sync-audit-billing.md`, `01-platform-org.md` (retention, ПКУ); ADR-0008 (amendments 3, 4,
  7), ADR-0011, ADR-0013 (amendments 2026-10-05, -15, -19, -21), ADR-0018 п. 6, 9, ADR-0019.
- API: `main.ts`, `problem-details.filter.ts`, `audit/*` (service, journal, repository), `auth/sessions.service.ts`,
  `auth/activations.service.ts`, `auth/login-limiter.ts`, `terminals/terminal-sessions.service.ts`,
  `platform/auth/operator-sessions.service.ts`, `platform/tenants/tenants.service.ts`, `platform/retention/*`,
  `pos/receipts.service.ts`, `pos/prescription-retention.ts`, `pos/sales-figures.ts`, `pos/held-receipts.service.ts`,
  `sync/inbox-retention.ts`, `reports/*`, `staff/*`, cost gating in `inventory/*`, `pricing/prices.service.ts`,
  `purchasing/*`, `stores/store-closing.service.ts`, `core/sessions/*`; all logger calls.
- Shared: `libs/shared/domain` (permissions, role templates, audit groups, operator permissions), DTO cost fields.
- Frontend: `shared/api/client.ts` (web, admin), `sw/sw.template.js`, `shared/lib/offline-queue/*`,
  `shared/lib/terminal-cache`, `features/pos/lib/receipt-print.ts`, report/audit export buttons, localStorage use.
- Outbound/telemetry scan of `apps`, `libs`, `tools` (fetch, axios, http(s), nodemailer, SMS, analytics, telemetry,
  external URLs); `nx.json`, `tools/scripts/stack.mjs`, `docker/redis/redis.conf`.
- Fixtures: `apps/web/src/shared/api/mocks`, `apps/admin/src/shared/api/mocks`, `apps/web-e2e`, `apps/api-e2e`,
  `apps/api/scripts` (tracked files only).

**Personal data inventory (where it lives → who reads it through the API):**

| Data | Table / store | Exposed to |
|---|---|---|
| Employee full name, login, phone, e-mail, last sign-in | `employees` | `employees:view` within store scope (`staff.repository.ts:79-121`); names in reports, audit journal, receipts |
| Password/PIN/one-time-code hashes | `employee_credentials`, `operator_credentials` | never returned (PIN only as booleans `pinSet`/`pinLocked`) |
| Owner contact (name, login, phone, e-mail), billing requisites | `tenants` | operators (`tenants:view`); the tenant's own row |
| Operator login (work e-mail), name | `operators` | all operators (`platform:view`) |
| Legal entity / supplier requisites (may name an individual entrepreneur) | `legal_entities`, `suppliers` | tenant roles per module |
| Prescription number, date, clinic, doctor; **buyer name, buyer ID document** | `controlled_sale_records.prescription_note`, `sync_inbox.envelope`, till IndexedDB (encrypted) | only the first four, via `GET /reports/controlled` (`reports:view`); buyer fields never leave the DB |
| IP of sign-ins | `audit_log.details.ip`, `platform_audit_log.details.ip` | not projected by any API |
| Device label («Chrome · Windows») | operator session in Redis | the operator himself |
| Cashier name | printed receipt, Z-report | customers / staff |

No customer (buyer) table, no e-mail/SMS sending, no file storage (prescription files: column always null).

## 2. Findings

### P1 — Medium — API responses carry no `Cache-Control: no-store`; personal and prescription data persist in the browser cache of shared PCs
- **Location:** `apps/api/src/main.ts:61-63`; no `Cache-Control`/`no-store` anywhere in `apps/api/src`.
- **Evidence:** `app.use(helmet());` — helmet sets no cache header; Express adds an ETag to every JSON body, so a
  200 GET is storable in the HTTP disk cache.
- **Scenario:** a manager signs in by password on a till PC (terminal binding requires exactly this,
  ADR-0008) and opens `/reports/controlled` (prescription number, clinic, doctor) or `/employees` (phones, e-mails).
  After logout the bodies remain in the Chromium disk cache of the shared Windows profile that cashiers use all day.
  The app itself minimises the till's IndexedDB copy (`terminal-cache.ts:54` drops the phone), but the HTTP cache keeps
  the full `/sessions/current` body anyway.
- **Recommendation:** one middleware for `/api/*`: `Cache-Control: no-store` (plus `Pragma: no-cache`); or the same
  header at Caddy for `/api`.
- **Confidence:** likely (needs a runtime check behind Caddy).

### P2 — Low — Password, activation and operator lockouts are not audited
- **Location:** `apps/api/src/app/auth/sessions.service.ts:154-157`, `:229-231`; `auth/activations.service.ts:96`;
  `platform/auth/operator-sessions.service.ts:151`.
- **Evidence:** `if (!attempt.allowed) { throw new LockedException(429, 'login_locked', …) }` with no audit append,
  whereas the PIN path writes `auth.pin-locked` (`terminal-sessions.service.ts:137`).
- **Scenario:** password spraying against an owner's phone: after the limit is reached, the lock and every further
  attempt leave no row in `audit_log`/`platform_audit_log`; the owner sees a few `auth.login-failed` rows, not that the
  account was locked or for how long the attack went on.
- **Recommendation:** write `auth.login-locked` (tenant) / `auth.operator-login-locked` (platform) once per lock window,
  with `ip`; unknown identifiers stay in the app log.
- **Confidence:** confirmed.

### P3 — Low — Role and employee changes are audited without what changed
- **Location:** `apps/api/src/app/staff/roles.service.ts:111-115`, `:75-79`; `staff/employees.service.ts:221-224`.
- **Evidence:** `details: { name: input.name, permissions: permissions.length }`; `employee.updated` has no details.
- **Scenario:** a manager with `roles:manage` adds `finance:view-cost` or `employees:manage-peers` to a role, or a user
  with `employees:update` changes a colleague's phone/e-mail (both are sign-in identifiers). The journal shows only
  "role updated (14 permissions)" / "employee updated"; an investigation cannot tell which permission was granted or
  that a sign-in identifier was replaced. ADR-0018 п. 9 asks for audit of role and permission changes.
- **Recommendation:** role events: `added`/`removed` permission lists; employee events: names of changed fields
  (`login`, `phone`, `email`, `fullName`), values masked.
- **Confidence:** confirmed.

### P4 — Low — Prescription data of the ПКУ journal is open to any role with `reports:view`; reads are not audited
- **Location:** `apps/api/src/app/reports/reports.controller.ts:16-17`; `reports/reports.service.ts:214-228`;
  `pos/sales-figures.ts:224-229`.
- **Evidence:** `@RequirePermission('reports:view')` covers all report kinds, including `controlled`.
- **Scenario:** the default «Бухгалтер» role (network scope, `reports:view`) or any custom role reads prescription
  numbers, dates, clinics and doctors of every ПКУ sale in 366-day windows; nothing records the read. Number + clinic +
  date identifies the patient at the clinic.
- **Recommendation:** architect decision: a dedicated permission for the ПКУ journal and an audit event for reading the
  `controlled` kind (period, store).
- **Confidence:** confirmed.

### P5 — Low — Employee personal data has no end of life; identifiers stay reserved platform-wide forever
- **Location:** `libs/shared/dto/src/lib/tenant-staff.ts:17`; `apps/api/src/app/staff/employees.service.ts:284-305`;
  `migrations/1790934768191_auth-identity-audit.sql:15-17`.
- **Evidence:** `export type EmployeeStatus = 'active' | 'blocked';` — the schema has `archived` and the catalog has
  `employees:delete`, but no route archives, deletes or anonymises.
- **Scenario:** a cashier leaves pharmacy A: name, phone, e-mail, login and last sign-in stay readable to A's
  `employees:view` holders indefinitely; pharmacy B cannot register the same person with that phone/e-mail
  (`409 phone_taken`).
- **Recommendation:** an archive action that blanks phone/e-mail/login (keeps id and full name for receipts and audit),
  with a retention rule agreed with a lawyer.
- **Confidence:** confirmed.

### P6 — Low — Cross-tenant existence oracle for phones, e-mails and logins
- **Location:** `apps/api/src/app/staff/employees.service.ts:50-53`; global unique indexes
  `auth-identity-audit.sql:15-17`.
- **Evidence:** `employees_phone_global_uq: { code: 'phone_taken', field: 'phone' }`.
- **Scenario:** a manager of network B (`employees:create`, fresh password) submits candidate phones/e-mails; `409
  phone_taken`/`email_taken` reveals that the person works for some network on the platform, building a target list for
  `POST /sessions`, which itself hides existence (timing padding, `sessions.service.ts:122-130`). Failed creates are not
  audited.
- **Recommendation:** document as accepted, or audit `employee.create-refused` with the conflicting field; revisit with
  P5 (global uniqueness of identifiers).
- **Confidence:** confirmed.

### P7 — Low — `audit_log` partitions end in December 2027 and nothing creates new ones
- **Location:** `migrations/1790934768191_auth-identity-audit.sql:89-122`; no partition DDL in `apps/api/src`.
- **Evidence:** "No DEFAULT partition: an insert outside them fails loudly. Later partitions are created ahead by a
  scheduled job" — the job does not exist.
- **Scenario:** from 2028-01-01 00:00 UTC every audited operation fails — sales (`receipts.service.ts:351`), sign-ins,
  stock documents — because the audit row is in the same transaction. `stock_movements` ends 2028-12. Outside the pilot
  window, but a hard stop.
- **Recommendation:** a tracked ticket: a migration/job creating partitions ≥ 12 months ahead and a check in
  `stack … ps`/backup-status style.
- **Confidence:** confirmed.

### P8 — Low — Quarantined ПКУ sales keep buyer and prescription data on the till beyond retention
- **Location:** `apps/web/src/shared/lib/offline-queue/queue.ts:1-8`, `:241`; `controlled-crypto.ts:24-37`.
- **Evidence:** "409 and other 4xx — quarantine: kept for the manager, never removed silently"; the queue has no
  discard or expiry; the AES key sits in the same IndexedDB.
- **Scenario:** a ПКУ sale refused with a 4xx stays in the till's browser profile indefinitely with buyer name and
  document. The hourly purge covers server tables only; the non-exportable key stops copying the database file, not
  someone using the same browser profile.
- **Recommendation:** an audited discard in the quarantine review, or drop the sealed `controlled` of a quarantined
  record after `prescription_retention_days`.
- **Confidence:** likely.

### P9 — Info — Buyer name and ID document are collected and stored but never used
- **Location:** `apps/api/src/app/pos/receipts.service.ts:43-50`; `pos/sales-figures.ts:52-56`.
- **Evidence:** `NOTE_FIELDS` includes `'buyerName'`, `'buyerDocument'`; the only reader selects four other fields.
- **Scenario:** the most sensitive fields (patient name, passport/ID number) are kept 90 days (configurable to 3650)
  and in backups, with no product use; only a DBA could produce them for an inspection.
- **Recommendation:** stop collecting them, or define the legal purpose and a permissioned, audited access path.
- **Confidence:** confirmed.

### P10 — Info — Web mocks and e2e fixtures use realistic names with in-range mobile numbers
- **Location:** `apps/web/src/shared/api/mocks/fixtures.ts:66-137`; `mocks/db-stock.ts:256-272`;
  `apps/web-e2e/src/support/fake-api.ts:130`.
- **Evidence:** `phone: '+992 93 220-77-04'` next to full names; the admin mocks use reserved `+992 00 000 00 0x`.
- **Scenario:** a number may belong to a real person and appears in demos/screenshots. The intent is synthetic
  (`db-owner.ts:206`); no real client data was found.
- **Recommendation:** switch to the `+992 00 …` pattern of the admin mocks.
- **Confidence:** confirmed (cannot verify that the numbers are unassigned).

## 3. Controls verified

- `audit_log` append-only: only `SELECT, INSERT` for `pharmacy_app` (`auth-identity-audit.sql:147`); UPDATE/DELETE and
  TRUNCATE triggers (`:133-138`); TRUNCATE trigger on every partition (`db-guards.sql:11-27`).
- `platform_audit_log` append-only: triggers `operators.sql:54-58`, grants `:78`.
- ПКУ records: DELETE forbidden, UPDATE only clears prescription columns once (`pos-offline-limits.sql:34-62`); journal
  base `stock_movements` append-only (`inventory-core.sql:264-273`, `:326`).
- Prescription purge: hourly, every tenant whatever its status (`retention.repository.ts:9-13`), in tenant context under
  RLS, audited with counts only (`prescription-retention.ts:41-63`); offline envelopes too (`inbox-retention.ts:46-71`).
- No prescription data in audit (`receipts.service.ts:350-366`) or logs (`prescription-purge.scheduler.ts:96-112`);
  buyer fields never projected (`sales-figures.ts:52-56`, `:224-229`).
- Held receipts store an explicit line mapping without ПКУ data (`held-receipts.service.ts:106-114`); global
  `whitelist` + `forbidNonWhitelisted` (`validation-pipe.ts:51-52`).
- Till buffer: ПКУ data AES-GCM with a non-exportable key (`controlled-crypto.ts:24-33`, `:59-69`); terminal cache drops
  the phone (`terminal-cache.ts:54`); Service Worker never touches `/api/` (`sw.template.js:52`).
- ADR-0011: no outbound HTTP, mail, SMS, analytics or error-tracking code in `apps`, `libs`, `tools`; frontends call
  only same-origin `/api/v1` (`web/src/shared/api/client.ts:19`, `:84`; `admin/src/shared/api/client.ts:18`, `:79`);
  fonts self-hosted (`libs/ui/assets/fonts`); `fiscal` and `export-1c` modules are empty.
- Telemetry off: `nx.json:74` (`"analytics": false`), `stack.mjs:204` and `.env.example:9`
  (`NEXT_TELEMETRY_DISABLED=1`).
- Error responses never echo input, unknown errors are logged by name and frames only
  (`problem-details.filter.ts:41-42`, `:206-210`); auth logs omit identifiers (`sessions.service.ts:166-169`,
  `operator-sessions.service.ts:266-273`).
- Limiter keys in Redis are hashes of identifiers (`login-limiter.ts:31-33`, `activation-code.ts:54-56`); session
  records hold ids, permissions and scope only (`core/sessions/session-store.ts:5-20`); operator device is a label, not
  the raw UA (`operator-session-store.ts:11-15`); Redis without persistence (`docker/redis/redis.conf:4-5`).
- Secrets at rest: hash-with-pepper-version constraints (`org-foundation.sql:83-85`, `operators.sql:29-30`); terminal
  credential stored as a 32-byte hash (`org-foundation.sql:186`).
- Platform isolation: platform sees only registry columns of `stores`, no address (`org-foundation.sql:279`), stats
  views without personal data (`admin-stats.sql:57-75`); platform audit details carry ids only
  (`tenants.service.ts:151-156`).
- Owner-code takeover path is visible to the tenant: `owner.activation-code-issued` with `acting_operator_id`
  (`issue-owner-code-pick-owner.sql:44-52`), shown in the owner's journal (`audit-groups.ts:43`).
- ADR-0018 п. 6 field-level cost hiding is server-side and consistent: `stock-documents.service.ts:343-348`,
  `purchase-orders.service.ts:265-268`, `suppliers.service.ts:197-198`, `payments.service.ts:48-49`,
  `report-builders.ts:61-75`, `prices.service.ts:189-197`, `catalog-snapshot.service.ts:162`,
  `supplier-returns.service.ts:451`, `write-offs.service.ts:427`, `stock-counts.service.ts:700-701`,
  `store-closing.service.ts:65`, `notifications.service.ts:188`, audit amounts `audit-journal.ts:169-171`.
- Employee list limited to the viewer's stores; owners (network scope) are hidden from store-scoped managers
  (`staff.repository.ts:113-121`); columns listed explicitly, no hashes (`:79-93`); no `selectAll` returned to clients.
- Audit journal projects a whitelist of values; IPs and ids are not exposed (`audit-journal.ts:160-215`).
- Security events audited: sign-in success/failure with IP (`sessions.service.ts:323-328`, `:403-408`), PIN
  failure/lock (`terminal-sessions.service.ts:137`, `:179`), re-confirmation (`sessions.service.ts:243-263`), `access.denied`
  (`access-denied-audit.interceptor.ts`), activation, password/PIN changes, role, assignment, block, terminal
  bind/revoke, settings with before/after (`settings.service.ts:119-123`), imports (`*.imported`), operator sign-ins.
- Receipts print the cashier's name only; no buyer or prescription data (`receipt-print.ts:77`). Report/audit Excel
  export disabled (`ReportsPage.tsx:124-131`, `AuditLogPage.tsx:144-152`).

## 4. Accepted limitations touched

- Backups unencrypted on the host, 30 days, include credential hashes and prescription data (ADR-0019): matches;
  `pharmacy_before_<copy>` kept after restore until removed by hand — data may outlive the retention term.
- Owner activation code issued by an operator replaces the owner's password (ADR-0008, amendment 7): code matches
  (both audit logs); the callback procedure is organisational only.
- Impersonation not implemented (ADR-0008, amendment 4): matches; operators cannot read tenant data in code.
- Operator sees owner contact and billing requisites (ADR-0013, amendment 2026-10-05 п. 4): matches; no platform grants
  on `employees`.
- Prescription retention 90 days, 1–3650, "confirm with a lawyer" (data model 01): matches.
- ПКУ buffer limits 8 h / 20 receipts (spec 2026-10-21, P6): matches `tenant_settings`.
- `TRUST_PROXY=0` makes audited IPs the proxy's until set (CLAUDE.md): matches; deploy prerequisite.
- Audit retention ≥ 3 years (data model 06): no deletion path exists; see P7 for partitions.
- Offline-store audit rows appended as the store sends them (`audit.service.ts:58-84`, ADR-0014): trusted by license
  key; no keys are issued in the pilot.
- Prescription files: column always null until the file-storage ADR: matches.
- Backup and restore are host operations, not recorded in `platform_audit_log` (ADR-0019): matches.

## 5. Questions for the architect

1. Hosting outside Tajikistan (hosting ADR on an unmerged branch) and personal-data localisation (stack.md q. 1): is a
   lawyer's sign-off needed before real pharmacy data?
2. Keep collecting buyer name and ID document (P9)? If yes, for what purpose and through which audited path?
3. A dedicated permission and a read audit for the ПКУ journal (P4)?
4. Employee end of life: anonymise on archive, and keep identifiers globally unique (P5, P6)?
5. An upper bound for audit retention, given IP addresses in sign-in events?
6. Accept up to 30 days of prescription data in backups and `pharmacy_before_*` beyond the retention term?
7. Who is the controller for pharmacy data (chain vs platform)? Is a data-processing agreement and privacy notice
   needed with the pilot chains?
