# План B — отложенные замечания и решения

Собрано из ledger выполнения плана `2026-09-30-data-layer.md` (2026-10-01). Ни одно не блокирует слияние: Critical и Important исправлены в финальном раунде. Пункты закрываются в планах, к которым они относятся (аутентификация, платформа, синхронизация, CI), или отдельными задачами.

## Решения (Ruling) при выполнении

- Pre-flight: Ruling: Task 2 is split — implementer does steps 1–3 without committing and reports; controller asks the user for step 4 (volume recreate + .env lines); then the implementer is resumed for step 5 verification and step 6 commit — subagents cannot ask the user, and the plan requires explicit consent — cost if wrong: one extra resume.
- Task 1: Ruling: reviewer Important "required DATABASE_URL/PLATFORM_DATABASE_URL break serve/compose until env files updated" — plan-ordering, closed by Task 2 step 3 (compose api PLATFORM_DATABASE_URL, .env.example URLs) and the user's .env update at the Task 2 STOP; branch is not merged in between — cost if wrong: broken intermediate commit c8e022b only
- Task 3: Ruling: reviewer Important "integration target uses deprecated @nx/jest:jest (warning every run)" is plan-mandated by the brief — spec does not require that executor and test output must be pristine; switch to nx:run-commands `jest --config …` like the inferred test targets — cost if wrong: one target definition
- Task 3: Ruling: re-graded Minor→Important "testDatabaseUrls guard only checks name != dev name" — the stand runs `drop schema pharmacy cascade`; a misconfigured TEST_DATABASE_NAME (e.g. postgres or another DB) would destroy data; require decoded name to match /^[a-z0-9_]+_test$/ and decode pathnames — cost if wrong: CI must name its DB *_test
- Task 4: Ruling: brief Step 5 "review by postgresql-database-reviewer agent" conflicts with the no-subagents rule for implementers and the agent type is not registered in this session — the controller runs the task review on the most capable model with .claude/agents/postgresql-database-reviewer.md as its checklist; the implementer self-reviews against the same file — cost if wrong: none, same checklist
- Task 4: Ruling: plan-mandated Minor "platform UPDATE on tenants has no column limit" — no platform code exists yet; narrow to `update (name, status, billing_*, updated_at)` with a catalog assertion when the platform module lands (new migration) — cost if wrong: platform path could rewrite tenants.code/id until then (no caller today)
- Task 4: Ruling: plan-mandated Minor "roles.name check weaker than README (non-empty object of strings)" — keep the DB check (non-empty object); correct README wording in the final fix wave to "непустой объект; строки и непустые значения проверяет приложение" — cost if wrong: a role could store {"ru":""} via a buggy app path
- Task 6: Ruling: plan-mandated Minor "withTenant(tenantId) is public on a @Global provider — any module can open any tenant" — ADR-0006 rule 1 mandates it; restricting direct withTenant callers (guards, TenantJobRunner) is deferred to the auth/jobs plans where those paths exist; Task 7 keeps its brief — cost if wrong: a service could bypass request context until then (review rule)
- Final: Ruling: fix wave also includes cheap Minors 2 (shared jest transformIgnorePatterns incl. @nestjs/config + backslash), 3 (manifest covers relkind v/m/f), 4 (no role/db-level app.* settings), 6 (plan text org-foundation) and T5 date→string pin — all small test/doc edits on the same files — cost if wrong: slightly larger fix diff
- Final: Ruling: drop Task 6 minor "#db" — the Focus-1 test reaches the root Kysely via db['db'] — cost if wrong: none

## Отложенные мелкие замечания

- Task 1: minor (deferred): pool.spec does not assert pool.options.types === pgTypes
- Task 1: minor (deferred): pool.on('error') handler untested
- Task 1: minor (deferred): pgTypes ignores format (binary) for int8/date overrides; `format as 'text'` cast
- Task 1: minor (deferred): no @Max on pool size / timeout env vars
- Task 1: minor (deferred): DB_STATEMENT_TIMEOUT_MS/DB_LOCK_TIMEOUT_MS consumed only in Task 6
- Task 2: minor (deferred): PUBLIC keeps CONNECT/TEMP on pharmacy, pharmacy_test, postgres — consider revoke + explicit grants; resolvers must schema-qualify (pg_temp)
- Task 2: minor (deferred): add `alter default privileges for role pharmacy_resolver revoke execute on functions from public` (changes expected pg_default_acl count to 2)
- Task 2: minor (deferred): .env.example passwords duplicated in URLs (documented)
- Task 2: minor (deferred): 01-roles.sh not executable in git (sourced by entrypoint)
- Task 3: minor (deferred): jest.integration.config.cts transform regex single backslash (works, copy error)
- Task 3: minor (deferred): global-setup drops spawnSync result.error/signal from the error message
- Task 3: minor (deferred): nx production named input does not exclude *.int-spec.ts / test/**
- Task 3: minor (deferred): decodeURIComponent throws raw URIError on malformed escape (no KEY context)
- Task 3: minor (deferred): prettier --check flags pool.ts and Task 3 files (format pass before merge)
- Task 4: minor (deferred, recommend fixing before merge): catalog does not forbid TRUNCATE/REFERENCES/TRIGGER for pharmacy_app on tenant tables (TRUNCATE bypasses RLS)
- Task 4: minor (deferred): 42501 assertion cannot distinguish WITH CHECK from missing grant — also match message /row-level security/
- Task 4: minor (deferred, model question): terminals unique (tenant_id, store_id, name) includes revoked terminals
- Task 4: minor (deferred): (revoked_at is null) = (revoked_by is null) forbids system-initiated revocation
- Task 4: minor (deferred): no tests for cross-tenant DELETE / tenant_id move UPDATE; connection reuse for both pools → Task 6
- Task 5: minor (deferred): db-types.spec does not pin date→string mapping (closedUntil: string | null)
- Task 5: minor (deferred): /pharmacy\./ regex could false-positive on future comments
- Task 6: minor (deferred): transaction after onModuleDestroy opens an unclosed pool — add closed flag
- Task 6: minor (deferred): private db reachable via (x as any).db — use #db
- Task 6: minor (deferred): getRequestContext returns live mutable store — freeze copy / Readonly
- Task 6: minor (deferred): lock_timeout asserted by value only, not by 55P03
- Task 6: minor (deferred): database.module.spec written after code (no RED)
- Task 7: minor (deferred): transitive re-export of PlatformDatabase via an allowed-zone file is not detected (inherent to ADR-0013 §7 textual rule) — add a comment
- Task 7: minor (deferred): regex scanner false-positives on imports/new Pool( inside comments (fails safe)
- Task 7: minor (deferred, plan-mandated): ESLint ignores disable all three rules in app/platform/** and app/sync/** (Jest scanner is the backstop) — comment on config block
- Task 7: minor (deferred): double ESLint message for platform import outside zones (cosmetic)
- Controller: minor (deferred): tools/scripts/stack.mjs triggers Node DEP0190 (spawn with shell:true and args) — pre-existing
- Task 8: minor (deferred): migrate service has no deploy.resources limits in test/prod overrides
- Task 8: minor (deferred): passwords embedded in compose URLs break on hand-written @ / : (base64url from stack init is safe) — doc note
- Task 8: minor (deferred): CLAUDE.md could mention `npm run stack -- <env> logs migrate` for failed migrations
- Final: minor (deferred): no idle_in_transaction_session_timeout in withTenant/platformTransaction (out of plan; add with config in a later plan)
- Final: minor (deferred, must precede auth guards): getRequestContext returns a mutable store
- Final: minor (deferred): exact-set test will need per-table exceptions for future append-only tenant tables (REVOKE UPDATE, DELETE)
- Final: minor (deferred): app.* role-setting test proven RED only indirectly (needs superuser)
- Auth part 1: follow-up (before 2027-11): a scheduled job creating monthly `audit_log` partitions (owner role) is needed — the part-1 migration creates partitions statically only up to 2027-12

## Заметки

- Task 1: ⚠️ resolved — `npx nx build api` exit 0, webpack compiled successfully (pg-native optional peer no warning)
- Task 1: note — implementer: stray tailwindcss entries in node_modules made `npm install -w` touch root package.json; reverted, lock regenerated with --package-lock-only
- Task 2: ⚠️ resolved — CLAUDE.md «Containers» (API connects only as pharmacy_app) is updated in Task 8 step 4
- Task 4: note: FORCE RLS binds pharmacy_owner (backfills need context) — document in migration guide; stores.updated_at not bumped by platform mode change; uuid nested 14 vs root 8.3.2 — verify in Task 8 prune/Docker and Node 22 require(esm)
- Task 5: note: db-types-verify needs migrated DB + MIGRATION_DATABASE_URL — CI service in plan C
- Task 6: ⚠️ noted: reuse tests cannot detect an is_local=false regression (next tx always sets a fresh value) — guarded by code review + isolation no-context test
- Task 7: note: `npx eslint` stack trace about tools/eslint-rules/tsconfig.json is pre-existing (FSD plan A)
