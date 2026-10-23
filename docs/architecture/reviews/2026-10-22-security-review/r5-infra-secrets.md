# R5 — Infrastructure, secrets and supply chain (main 80c4973)

## 1. Scope covered

- `apps/api/Dockerfile`, `apps/api/webpack.config.js`, `apps/api/package.json`, `.dockerignore`, `.gitignore`
- `docker/compose.yml`, `compose.dev.yml`, `compose.test.yml`, `compose.prod.yml`, `compose.backup.yml`
- `docker/postgres/Dockerfile`, `initdb/01-roles.sh`, `02-database.sql`, `03-provisioner-role.sql`, `04-backup-role.sql`,
  `docker/postgres/backup/pharmacy-backup`; `docker/redis/Dockerfile`, `redis.conf`
- `docker/env/test.env.example`, `docker/env/prod.env.example`, `.env.example` (real env files not opened)
- `tools/scripts/stack.mjs`
- `apps/api/src/app/config/env.validation.ts`, `src/core/crypto/key-ring.ts`, `src/main.ts`, `src/core/redis/*`,
  `src/app/auth/session-cookie.ts`, `device-cookie.ts`, `src/app/health/health.controller.ts`
- `apps/api/scripts/*.mjs` (migrate, create-activation-code, create-operator, issue/revoke-license-key,
  reapply-quarantine, generate-store-secrets)
- All 47 SQL migrations, parsed for tables, RLS ENABLE/FORCE, policies, grants and SECURITY DEFINER functions
- Git history: all 549 commits on 23 refs (no stashes). Every added line was scanned for private keys, URL
  credentials, `*PASSWORD/SECRET/TOKEN/PEPPER/JWT_KEYS=` assignments, GitHub/AWS/Slack/npm/LLM tokens, JWTs, `phk_`
  licence keys and key rings. Values were masked; only their hashes were compared.
- `npm audit --omit=dev --json`, `package-lock.json` (registries, integrity, install scripts, licences),
  `apps/web|admin/next.config.js`, `apps/web/src/shared/api/index.ts`, `mocks/session.ts`
- ADR-0005, ADR-0019, stack.md (questions 1 and 8)

## 2. Findings

### S1 — Low — A restore runs files from BACKUP_DIR as the superuser and never checks their integrity
- **Location:** `docker/postgres/backup/pharmacy-backup:162-166`, `:171-174`, `:445-446`; `docker/compose.backup.yml:14`
- **Evidence:** `apply_globals` pipes `globals.sql` into `psql` and drops only `CREATE|ALTER ROLE postgres` lines:
  `grep -v -E '^(CREATE|ALTER) ROLE postgres( |;)' "$2" | … | psql … $1 -d postgres`. `cmd_restore` runs it, and then
  `pg_restore` of `pharmacy.dump`, as `${POSTGRES_USER}` over the local socket. No checksum or allowlist is applied.
- **Attack / failure scenario:** ADR-0019 suggests that BACKUP_DIR may be a network volume. Whoever can write to it can
  plant a statement in the newest verified copy, for example `ALTER ROLE pharmacy_app SUPERUSER;`,
  `GRANT pg_execute_server_program TO pharmacy_app;` or `COPY … TO PROGRAM`. Writers include the storage admin, a
  compromised NAS, or a compromised `backup` container (it holds the BYPASSRLS password and a writable mount). The
  manifest sits in the same directory, so it can be forged too. In an incident, `restore --replace-database` runs that
  SQL as the superuser. The API role gains superuser rights, or the attacker gets command execution in the postgres
  container. `--check` shows only the manifest figures.
- **Recommendation:** Before replaying `globals.sql`, accept only `CREATE ROLE` / `ALTER ROLE` / `GRANT <role> TO
  <role>` lines for the known `pharmacy_*` names and refuse SUPERUSER. Allow BYPASSRLS only for `pharmacy_backup`.
  Alternatively, skip replaying globals when the roles already exist. Document BACKUP_DIR as a trust boundary: only
  uid 70 and root write to it, never a shared volume.
- **Confidence:** confirmed in the code; exploitation requires write access to BACKUP_DIR.

### S2 — Low — Placeholder passwords are not refused in test/prod env files
- **Location:** `tools/scripts/stack.mjs:166-168` (placeholders are replaced only by `init`), `:222-234` (`up` and `build`
  check only that the file and the backup variables exist); `docker/compose.yml:20-23,41`;
  `docker/env/prod.env.example:1,8-12,27`
- **Evidence:** `.replace(/change-me/g, () => randomBytes(18)…)` runs only in `init`. The example file also says
  "Copy to docker/env/prod.env … or run: npm run stack -- prod init". Compose `:?` rejects only empty values.
- **Attack / failure scenario:** An operator copies the example by hand and generates only the JWT and pepper keys,
  because the API refuses `k1:generate-key` (9 bytes < 32). PostgreSQL superuser, owner, app, platform, backup and
  Redis then all run with the password `change-me`. In test, PostgreSQL is published on `127.0.0.1:5433`, so any local
  user of the host becomes superuser. In prod, any process in the compose network can do the same.
- **Recommendation:** In `stack.mjs`, for test/prod, fail `build` and `up` when the env file still contains `change-me`
  or `generate-key`, or a password shorter than 16 characters.
- **Confidence:** confirmed.

### S3 — Low — The API container can rewrite its own code and runs with default capabilities
- **Location:** `apps/api/Dockerfile:19-21`; `docker/compose.yml:66-109`, `compose.prod.yml:15-19`
- **Evidence:** `COPY --from=build --chown=node:node /workspace/apps/api/dist ./` followed by `USER node`. `main.js`,
  `scripts/` and `migrations/` belong to the runtime user. The `api` service sets no `read_only`, `cap_drop` or
  `security_opt: no-new-privileges`.
- **Attack / failure scenario:** An RCE in the API, for example through a dependency, can patch `/app/main.js` and plant
  a backdoor, such as logging passwords at sign-in. `restart: unless-stopped` restarts the same container, so the
  change survives crashes and restarts until the next `up` recreates the container. The image also ships `main.js.map`
  (full sources) and npm. These are minor.
- **Recommendation:** Copy without `--chown`, so the files stay root-owned and read-only for `node`. Add
  `read_only: true` with a `tmpfs: /tmp`, `cap_drop: [ALL]` and `security_opt: [no-new-privileges:true]` to `api`,
  `migrate` and `backup`, and optionally `pids_limit`.
- **Confidence:** confirmed (ownership follows from Docker COPY semantics).

### S4 — Low — Vulnerable `next` and `axios` in root production dependencies (not in the deployed runtime)
- **Location:** `package.json` (`"next": "~16.1.6"` → 16.1.7 locked; `"axios": "^1.6.0"` → 1.18.1)
- **Evidence:** `npm audit --omit=dev` finds 1 critical and 5 high:
  - **critical:** `next` 16.1.7 (`node_modules/next`). It carries about 30 advisories, among them unauthenticated RCE
    on Windows-hosted servers (GHSA-p293-qw3h-jr36), RCE in image optimization with AVIF (GHSA-2xp9-vwfh-vxw4), SSRF,
    cache poisoning, middleware bypass and dev-server MCP information disclosure (GHSA-39w2-rjm5-chcv). The fix is
    16.4.2, not a major upgrade.
  - **high:** `postcss` 8.4.31, `sharp` 0.34.5 (optional, libvips/libheif/librsvg CVEs) and `source-map-js` 1.2.1,
    all via `next`.
  - **high:** `axios` 1.18.1 (12 advisories: prototype-pollution gadgets, SSRF via redirects, ReDoS) and
    `follow-redirects` 1.16.0 (credential-header stripping bypass) via `axios`.
- **Attack / failure scenario:** In test and prod, web and admin are static exports with `images.unoptimized`. No
  Next.js server runs and no `beforeInteractive` or `dangerouslySetInnerHTML` is used. `axios` is imported only by
  `apps/api-e2e`, and `apps/api` dependencies are clean. So the pilot runtime is not exposed. The exposure is
  `next dev`, which listens on all interfaces by default, on developers' Windows machines. Those machines hold
  `docker/env/test.env` and the dev `.env`.
- **Recommendation:** Upgrade `next` to ≥ 16.4.2. Move `axios` to devDependencies and upgrade it to ≥ 1.20.0. Run
  `next dev -H 127.0.0.1` in the `dev` and `dev-api` targets.
- **Confidence:** confirmed (audit output and import graph). Whether the advisories apply to `next dev` was not
  verified offline.

### S5 — Low — A production static build can bundle the API mocks from the ambient environment
- **Location:** `apps/web/next.config.js:12`, `apps/admin/next.config.js:12`; `tools/scripts/stack.mjs:203-205`;
  `apps/web/src/shared/api/mocks/session.ts:88-89`
- **Evidence:** `env: { NEXT_PUBLIC_API_MOCKS: process.env.NEXT_PUBLIC_API_MOCKS ?? 'false' }`. The build runs with
  `env: { ...process.env, NODE_ENV: 'production', … }`, and Nx also loads the gitignored `.env` and `.env.local` files
  into tasks. The clean-tree check does not see either.
- **Attack / failure scenario:** If the building machine has `NEXT_PUBLIC_API_MOCKS=partial|true`, the shipped
  bundle routes calls that apps/api does not serve to in-browser mocks. The `partial` mode also answers as the demo
  owner `firuz`. Real pharmacy users then see fake data, and operations they believe were saved are not. The server
  still enforces auth, so this is an integrity and confusion risk, not a data leak.
- **Recommendation:** In `build()`, force `NEXT_PUBLIC_API_MOCKS: 'false'`. Optionally fail the build when
  `out/` contains the mock chunk.
- **Confidence:** needs a runtime check (depends on the builder's environment).

### S6 — Info — Secrets are visible in container metadata and process arguments
- **Location:** `docker/compose.yml:37-47` (`--requirepass ${REDIS_PASSWORD}`, healthcheck `redis-cli -a`),
  `:17-24` (all role and superuser passwords stay in the `postgres` environment for the container's lifetime);
  `docker/postgres/initdb/01-roles.sh:18-19` (passwords passed as `psql -v` arguments)
- **Evidence and scenario:** `docker inspect` shows these values to anyone with Docker access. Docker access is
  already root-equivalent, so this matters only for the audit trail.
- **Recommendation:** When the secret-store ADR (question 8) lands, move to `*_FILE` / compose secrets and a Redis
  `aclfile`.
- **Confidence:** confirmed.

### S7 — Info — Flat compose network; superuser password login is reachable from every container
- **Location:** `docker/compose.yml` (single default network); the official postgres image's
  `host all all all scram-sha-256`; `docker/redis/redis.conf:2-3` (default user, all commands)
- **Evidence and scenario:** After an API RCE, the attacker can try the `postgres` superuser and `pharmacy_backup` over
  TCP and reach Redis with full commands. The passwords are random (144 bits), so this is defence in depth only.
- **Recommendation:** Add a custom `pg_hba.conf` that rejects `postgres` and `pharmacy_owner` from the network except
  for `migrate`, and lets `pharmacy_backup` in only from the backup service. Use separate networks for
  `backup`↔`postgres` and `api`↔`redis`. Give Redis an ACL user without `CONFIG`, `FLUSHALL` or `DEBUG`.
- **Confidence:** confirmed for compose. The image's pg_hba is the documented default (needs a runtime check).

### S8 — Info — The Docker build context includes gitignored working files
- **Location:** `.dockerignore` (has no `.superpowers`, `.agents`, `tmp`, `**/out-tsc`); `apps/api/Dockerfile:11`
  (`COPY . .`)
- **Evidence and scenario:** The security review reports and the SDD ledgers enter the build stage and the BuildKit
  cache of the build host. They are not in the runtime image.
- **Recommendation:** Add these paths to `.dockerignore`.
- **Confidence:** confirmed.

### S9 — Info — `stack.mjs` passes unescaped arguments to cmd.exe on Windows
- **Location:** `tools/scripts/stack.mjs:51,59,72` (`shell: process.platform === 'win32'`); `:104,114,266,272` pass
  CLI `services`; `:110-111,154` pass `POSTGRES_SUPERUSER`/`POSTGRES_DB` read from the env file
- **Evidence and scenario:** A service name or env value containing `&` or `|` runs as a command. These are inputs of
  the operator's own machine, and Linux hosts use `shell: false`. Copy names are already validated (`:42,120`).
- **Recommendation:** Validate `services` against `/^[a-z0-9-]+$/` and the env values against `/^[A-Za-z0-9_]+$/`.
- **Confidence:** confirmed.

## 3. Controls verified

- API image runs as non-root: `apps/api/Dockerfile:21`; runtime has prod deps only, from the pruned lockfile: `:20`
- Base images pinned by version and digest: `apps/api/Dockerfile:6`, `docker/postgres/Dockerfile:3`,
  `docker/redis/Dockerfile:3`
- `.dockerignore` excludes `.git`, `.claude`, `**/.env*`, `**/*.env`, `docker/env`, `*.pem`, `*.key`: `.dockerignore:8-22`
- `.gitignore` covers `.env`, `.env.*`, `docker/env/*.env`, `*.pem`, `*.key`: `.gitignore:52-57`.
  `git check-ignore` confirms `docker/env/test.env` and `prod.env` are ignored.
- Git history (549 commits, all refs) has no committed secret. The only env files ever added are the three
  `*.example` files. Every masked hit is a placeholder, a test fixture or an image digest.
- Example env files hold placeholders only: `docker/env/prod.env.example:8-17,27`, `test.env.example:8-17,27`. The
  `.env.example` dev keys are labelled public and refused in prod: `key-ring.ts:64-67`, `env.validation.ts:311-323`
- `PHARMACY_OWNER_PASSWORD` goes only to `postgres` and `migrate`: `compose.yml:21,59` (absent from `api` `:71-99`).
  The superuser password goes only to `postgres`: `:20`. The backup password goes only to `postgres` and `backup`:
  `compose.backup.yml:11,26`.
- Published ports are 127.0.0.1 only: `compose.yml:101`, `compose.dev.yml:7,10`, `compose.test.yml:7`. Prod
  publishes no DB or Redis: `compose.prod.yml:1-19`
- Redis requires a password and keeps no persistence: `compose.yml:40-41`, `redis.conf:3-5`
- Restart policies, resource limits and log rotation in test/prod: `compose.prod.yml:6-24`, `compose.test.yml:5-25`,
  `compose.yml:7-11`; `migrate` uses `restart: 'no'`: `compose.yml:63`
- `stack init` writes 32-byte keys and 18-byte passwords to a file with mode 0600, and prints names only:
  `stack.mjs:166-171,191-192`
- Prod builds only from a clean tree, and `--skip-checks` is refused for prod: `stack.mjs:81-83,225`
- Env validation: keys must be ≥ 32 bytes (`key-ring.ts:48`). `AUTH_TEST_COOKIES` is allowed only with
  `APP_ENV=test` (`env.validation.ts:286-288`). Key material is redacted after parsing (`env.validation.ts:348-349`,
  `key-ring.ts:87-94`).
- Cloud cookies are `__Host-`, Secure, HttpOnly and SameSite=Strict: `session-cookie.ts:33-44`, `device-cookie.ts:16-28`
- helmet is on, and `trust proxy` is opt-in by hop count: `main.ts:58-61`. The health endpoint reveals nothing:
  `health.controller.ts:12-14`
- Runtime roles are NOSUPERUSER and NOBYPASSRLS: `01-roles.sh:20-24`. Schema `public` is revoked from PUBLIC:
  `02-database.sql:3`. Default EXECUTE is revoked: `02-database.sql:8`
- All 47 migrations: every tenant table has ENABLE and FORCE RLS, and policies are scoped per role. There are no
  default table privileges and every grant is explicit. Nothing is granted to PUBLIC or WITH GRANT OPTION.
  `pharmacy_platform` has no grants on tenant operational tables.
- Append-only at the grant level: `audit_log`, `platform_audit_log`, `stock_movements`, `receipts`, `payments` and
  `supplier_ledger_entries` get only `select, insert`.
- SECURITY DEFINER functions use `set search_path = ''`, owners are NOLOGIN, and EXECUTE is revoked from PUBLIC:
  `1790934768191_auth-identity-audit.sql:29,52-53` (same pattern in all 10)
- Backup role: no superuser, BYPASSRLS plus `pg_read_all_data`, `connection limit 2`: `04-backup-role.sql:15-19`
- Backup files: copies 0600 and directories 0700 (`pharmacy-backup:21`), no passwords in globals (`:278`), copy names
  validated (`:57,429`), scratch instance on a unix socket only (`:150`)
- Ops scripts:
  - Licence key: 256-bit secret, only its SHA-256 stored, printed once (`issue-license-key.mjs:67-69,114`)
  - Activation codes: 128-bit, SHA-256 stored (`create-activation-code.mjs:94,161`)
  - Store secrets: never printed, file mode 0600, never overwritten (`generate-store-secrets.mjs:81-98`)
  - The migrator never prints its URL (`migrate.mjs:2,29`)
- Lockfile v3: every package resolves from registry.npmjs.org with integrity, and `npm ci` is used in the
  Dockerfile. No Nx Cloud token and no `.npmrc`. `npm audit` flags no dependency of `apps/api`.

## 4. Accepted limitations touched

- ADR-0019: copies sit unencrypted on the host disk with mode 0600. Code matches (`umask 077`). Off-host copy and
  encryption are left "до prod" and still open.
- ADR-0019: `pharmacy_backup` is a BYPASSRLS exception to ADR-0013. Code matches.
- ADR-0019: there is no monitoring; the operator checks `ps` and `backup-status` daily. Code matches.
- stack.md question 8 and CLAUDE.md: secrets live in env files on the host until a secret-store ADR, due
  "до прод-деплоя". Code matches; the question is open.
- ADR-0008: the env file (pepper, JWT keys) is not part of the copies. Code matches: it is printed as a reminder at
  `stack.mjs:158-159`.
- ADR-0009 and the memory note: CI, Trivy, Dependabot and nightly `npm audit` are deferred. Matches: there is no
  `.github`.
- ADR-0005: base images are pinned by digest and updated deliberately. Matches; image scanning is still undefined.
- ADR-0012 and CLAUDE.md: `TRUST_PROXY` must equal the real hop count behind Caddy. The code default is 0, as
  documented.
- C4: Redis without persistence; a restore resets all sessions. Matches.

## 5. Questions for the architect

1. Is the pilot (real chains on the Contabo VPS) "prod" for the ADR-0019 condition "до prod" (off-host, encrypted
   copies) and for stack.md question 8 "до прод-деплоя" (secret store)? Must both be done before real data arrives?
2. Redis uses `maxmemory-policy volatile-lru`. Sessions and the login, PIN and throttle counters all carry TTLs, so
   under memory pressure they are evicted: lockouts fail open. Keep this, or use `noeviction` (fail closed)?
3. Caddy: will it run in the compose network or on the host? Confirm `TRUST_PROXY=1` and that Caddy overwrites
   `X-Forwarded-For`. Confirm that it adds HSTS and CSP for the static web/admin, redirects HTTP to HTTPS, and keeps
   `127.0.0.1:${API_PORT}` unexposed.
4. If the test environment (W2-05) ever holds customer data, should `APP_ENV=test` also refuse the public dev keys
   and `http://` origins?
5. A restore into an existing cluster replays `globals.sql`. Is that wanted, or only after disk loss (see S1)?
6. Who on the VPS is in the `docker` group or has root? Docker access means all secrets and all tenant data.
7. Upgrade `next` and move `axios` to devDependencies before the pilot (S4)?
