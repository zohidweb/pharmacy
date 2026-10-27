# Хранилище секретов — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** в test и prod каждый секрет попадает в контейнеры только файлом через `secrets:` Compose, а в `docker
inspect`, `docker compose config`, окружении контейнеров и аргументах процессов секретов нет.

**Architecture:** базовый `compose.yml` без секретов; dev получает свои значения из `.env` в `compose.dev.yml`, test и prod —
из каталога `SECRETS_DIR` через новый `compose.secrets.yml`. Node-процессы образа `api` читают `*_FILE` загрузчиком
из `NODE_OPTIONS=--import`, PostgreSQL — `POSTGRES_PASSWORD_FILE` и `PHARMACY_*_PASSWORD_FILE`, Redis — файл ACL,
`pharmacy-backup` — свои `*_FILE`. Секреты создаёт и проверяет `pharmacy-secrets` из образа `pharmacy/postgres`,
`stack.mjs` вызывает его и переносит секреты прежних env-файлов test.

**Tech Stack:** Docker Compose (secrets без Swarm), POSIX sh (busybox образа `pharmacy/postgres`), Node.js 24 (ESM,
только встроенные модули), Redis ACL.

**Spec:** `docs/superpowers/specs/2026-10-27-secret-store-design.md` (K1–K16), ADR-0021.

## Global Constraints

- Десять файлов секретов (раздел 3 спецификации): `postgres_superuser_password`, `pharmacy_owner_password`,
  `pharmacy_app_password`, `pharmacy_platform_password`, `pharmacy_backup_password`, `redis_password`, `redis_users_acl`,
  `session_jwt_keys`, `password_peppers`, `offsite_secret_access_key`.
- Каталог — `SECRETS_DIR` env-файла, путь относительно `docker/` (`./secrets/test`, `./secrets/prod`), 0700; файлы
  0444, без перевода строки в конце.
- В контейнере секрет — `/run/secrets/<файл>`; сервис получает только свои (таблица раздела 3).
- Значения секретов не печатаются нигде: ни в выводе скриптов, ни в ошибках, ни в логах проверки. Ошибки называют
  переменную или файл и путь.
- Без новых зависимостей npm и пакетов образов.
- Тесты отложены до MVP: новых автотестов нет; проверка задач — `sh -n`, `node --check`, `docker compose config` и
  пробы, всё вместе — живой прогон задачи 7. Полный `npm run check` запускает пользователь.
- **В `pharmacy-minors` не запускать `stack test init/up/build` и не трогать `docker/env/test.env`:** это env-файл
  стенда пользователя `pharmacy-test`. Живые проверки — только во временном worktree с другим именем проекта.
- Коммиты — Conventional Commits, `--no-gpg-sign`, в конце `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Дочерний процесс Node наследует `NODE_OPTIONS`** и снова запускает загрузчик: если `*_FILE` остались в окружении
   рядом с уже заданной переменной, ребёнок упадёт на «заданы обе». Загрузчик удаляет применённые `*_FILE` (проба в
   задаче 1).
2. **Пароль с символами URL** (`@ : / ? # %`) в файле должен дать рабочий URL подключения: пароль вставляется через
   `URL`, а не склейкой строк (проба в задаче 1).
3. **Файл, сохранённый редактором Windows** (CRLF, перевод строки в конце): загрузчик и `$(cat)` отбрасывают
   конечные `\n`, но не `\r`; `pharmacy-secrets check` отклоняет файл с `\r` или `\n` (проба в задаче 2).
4. **`stack test up` на env-файле старого формата без `init`**: `secrets init` создал бы новые пароли и новый pepper, и
   вход перестал бы работать. `up` и `restore` отказывают, пока в env-файле есть секретные переменные (задача 5).
5. **Linux-хост:** файлы, созданные контейнером `secrets` от root в каталоге `deploy` 0700, должны принадлежать
   владельцу каталога и иметь права 0444 (проба на томе с Linux-семантикой в задаче 7).

---

### Task 1: Загрузчик секретов API

**Files:**
- Create: `apps/api/scripts/secret-files.mjs`
- Modify: `apps/api/webpack.config.js` (assets)

**Interfaces:**
- Produces: модуль `/app/scripts/secret-files.mjs` в образе `api`; переменные, которые он понимает в compose:
  `DATABASE_PASSWORD_FILE` → `DATABASE_URL`, `PLATFORM_DATABASE_PASSWORD_FILE` → `PLATFORM_DATABASE_URL`,
  `REDIS_PASSWORD_FILE` → `REDIS_URL`, `MIGRATION_DATABASE_PASSWORD_FILE` → `MIGRATION_DATABASE_URL`,
  `SESSION_JWT_KEYS_FILE` → `SESSION_JWT_KEYS`, `PASSWORD_PEPPERS_FILE` → `PASSWORD_PEPPERS`.

- [ ] **Step 1: Написать `secret-files.mjs`** — модуль без экспорта, работает при импорте. Для каждой переменной
  окружения с именем `^([A-Z][A-Z0-9_]*)_FILE$` (V — группа):
  - V уже задана → ошибка «both V and V_FILE are set»;
  - файл читается `readFileSync(path, 'utf8')`, конечные `\n` (и `\r\n`) отбрасываются; не читается → ошибка
    «cannot read V_FILE (<путь>): <code>»;
  - V оканчивается на `_PASSWORD` и задана `<P>_URL` (P — V без `_PASSWORD`) → `new URL(<P>_URL)`; если в URL уже есть
    пароль — ошибка «<P>_URL already holds a password»; иначе `url.password = value`, `process.env[<P>_URL] = url.href`;
  - иначе `process.env[V] = value`;
  - применённая `V_FILE` удаляется из `process.env` (Review Focus 1).

  Ошибка — одна строка `secret-files: <сообщение>` в `process.stderr` и `process.exit(1)`; значений в сообщениях нет.
  Шапка файла — комментарий о назначении (ADR-0021, K4) и о том, что в dev загрузчика нет.
- [ ] **Step 2: Добавить asset** `{ input: './scripts', glob: 'secret-files.mjs', output: 'scripts' }` в
  `webpack.config.js` с комментарием по образцу соседних.
- [ ] **Step 3: Пробы** (временные файлы — в scratchpad, значения синтетические):
  - `node --check apps/api/scripts/secret-files.mjs` — без ошибок;
  - пароль `p@ss:w/rd?#%` в файле, `DATABASE_URL=postgres://u@h:5432/db`, `DATABASE_PASSWORD_FILE=<файл>`,
    `node --import=./apps/api/scripts/secret-files.mjs -e "<печать new URL(DATABASE_URL).password и
    decodeURIComponent(...) === исходному>"` — `true`;
  - `SESSION_JWT_KEYS_FILE` с файлом `k1:abc\n` → `SESSION_JWT_KEYS === 'k1:abc'`;
  - заданы `SESSION_JWT_KEYS` и `SESSION_JWT_KEYS_FILE` → код выхода 1, сообщение называет обе переменные;
  - несуществующий файл → код 1, в сообщении путь;
  - URL с паролем + `*_PASSWORD_FILE` → код 1;
  - `REDIS_URL=redis://redis:6379` + файл → `redis://:<пароль>@redis:6379`;
  - ребёнок: под загрузчиком `execFileSync(process.execPath, ['-e', 'process.exit(0)'])` при том же
    `NODE_OPTIONS` — успешно.

  Expected: все пробы как описано.
- [ ] **Step 4: Commit** `feat(api): secret files loader for test and prod (ADR-0021, K4)`.

### Task 2: Образ PostgreSQL — роли, `pharmacy-psql`, `pharmacy-secrets`

**Files:**
- Modify: `docker/postgres/initdb/01-roles.sh`, `docker/postgres/initdb/04-backup-role.sql` (шапка),
  `docker/postgres/initdb/03-provisioner-role.sql` (шапка, если в ней команда `psql` с паролем),
  `docker/postgres/Dockerfile`
- Create: `docker/postgres/pharmacy-psql`, `docker/postgres/pharmacy-secrets`

**Interfaces:**
- Consumes: имена файлов из Global Constraints.
- Produces:
  - `pharmacy-psql [аргументы psql…]` — `/usr/local/bin`, psql суперпользователем по `/var/run/postgresql`;
  - `pharmacy-secrets init|check` — `/usr/local/bin`, каталог секретов — `/s`;
  - переменные контейнера `postgres`: `POSTGRES_PASSWORD_FILE`, `PHARMACY_OWNER_PASSWORD_FILE`,
    `PHARMACY_APP_PASSWORD_FILE`, `PHARMACY_PLATFORM_PASSWORD_FILE`, `PHARMACY_BACKUP_PASSWORD_FILE`; в dev — прежние
    переменные без `_FILE`.

- [ ] **Step 1: `01-roles.sh`.** Работает и при `source` из entrypoint (bash), и при запуске (`/bin/sh`: образ,
  собранный на Windows, получает файлы 0755). Пароль каждой роли — из `PHARMACY_<РОЛЬ>_PASSWORD_FILE`, иначе из
  `PHARMACY_<РОЛЬ>_PASSWORD`; пустой → ошибка с именем переменной. Значения — в неэкспортируемые переменные, в psql —
  префиксом окружения одной команды (`owner_pw=… app_pw=… platform_pw=… psql …`), в SQL — `\getenv owner_pw owner_pw` и
  т. д., `password :'owner_pw'` как сейчас. Аргументов `-v …_pw=` больше нет. После psql переменные сбрасываются
  (`unset`).
- [ ] **Step 2: `pharmacy-psql`** (POSIX sh, `set -eu`): `PGPASSWORD` — из `POSTGRES_PASSWORD_FILE`, если задана
  (иначе остаётся как есть: dev входит по сокету без пароля); `PHARMACY_BACKUP_PASSWORD` — из
  `PHARMACY_BACKUP_PASSWORD_FILE`, если задана; обе экспортируются только для psql. Затем
  `exec psql -X -v ON_ERROR_STOP=1 -h /var/run/postgresql -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"` (последний `-d`
  или `-h` в `"$@"` побеждает). Шапка — назначение и примеры (роль копий, `drop database`, `alter role`).
- [ ] **Step 3: `pharmacy-secrets`** (POSIX sh, busybox, `umask 077`, каталог `/s`):
  - `init`: для каждого отсутствующего файла — значение, запись во временный файл рядом, `chmod 0444`, `mv`:
    пароли (`postgres_superuser_password`, четыре `pharmacy_*_password`, `redis_password`) — 24 байта `/dev/urandom` в
    base64url без `=`; `session_jwt_keys` — `k1:` + 32 байта, `password_peppers` — `1:` + 32 байта (base64url без `=`);
    `offsite_secret_access_key` — пустой. Существующие не трогает. `redis_users_acl` — строка
    `user default on #<sha256 redis_password> ~* &* +@all` без перевода строки; переписывается, только если
    отличается. Если владелец `/s` не root, новые файлы получают его uid:gid (`stat -c %u:%g /s`, `chown`).
    Значения: `head -c <n> /dev/urandom | base64 | tr '+/' '-_' | tr -d '=\n'`.
    Печатает имена созданных файлов.
  - `check`: все десять файлов есть; ни в одном нет `\r` и `\n`; пароли не короче 16 символов; кольца не пустые; ни в
    одном нет `change-me` и `generate-key`; `redis_users_acl` совпадает с хешем `redis_password` (иначе «run init»).
    Ошибки — по именам файлов, код 1; успех — `secrets: ok`.
  - другой аргумент — usage, код 2.
- [ ] **Step 4: Dockerfile:** `COPY --chmod=0755 pharmacy-psql pharmacy-secrets /usr/local/bin/` с комментарием
  (ADR-0021). Шапку `04-backup-role.sql` (и `03-provisioner-role.sql`, если там пароль в команде) — на
  `pharmacy-psql -q -f …`.
- [ ] **Step 5: Пробы:**
  - `sh -n` для трёх скриптов — без вывода;
  - `docker build -t pharmacy/postgres:secretprobe docker/postgres`;
  - `docker run --rm -v <scratch>/s:/s --entrypoint pharmacy-secrets pharmacy/postgres:secretprobe init` — создано 10
    файлов (по `ls`, без чтения содержимого); повторный `init` — ничего не создаёт; `check` — `secrets: ok`;
  - в копии каталога: дописать `\r\n` в `redis_password` → `check` код 1 и называет `redis_password`; удалить
    `password_peppers` → `check` называет его; `redis_users_acl` с чужим хешем → «run init».

  Expected: как описано; образ `secretprobe` и каталог удалить после проб.
- [ ] **Step 6: Commit** `feat(docker): secrets generator, pharmacy-psql and role passwords from files (ADR-0021, K5, K8)`.

### Task 3: `pharmacy-backup` — секреты из файлов и архив `env-push`

**Files:**
- Modify: `docker/postgres/backup/pharmacy-backup`

**Interfaces:**
- Consumes: `PGPASSWORD_FILE`, `RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY_FILE` (сервис `backup`),
  `POSTGRES_PASSWORD_FILE` (контейнер `postgres`, `restore`).
- Produces: `pharmacy-backup env-push` читает tar из stdin, объект `<APP_ENV>/env/<UTC>.tar.age`.

- [ ] **Step 1: Секреты при старте** — после определения `die`, до разбора команды: `PGPASSWORD` из `PGPASSWORD_FILE`,
  если задана (не читается → `die` с путём); `RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY` из своего `_FILE`, только если
  файл не пустой. Шапку («Environment: …») дополнить.
- [ ] **Step 2: `restore`** — пароль суперпользователя из `POSTGRES_PASSWORD_FILE`, иначе `POSTGRES_PASSWORD`.
- [ ] **Step 3: `env-push`** (K10) — stdin не терминал; первые 512 байт (`head -c 512` в `/tmp`: заголовок tar — имя,
  размер, права, без содержимого) проверяются: `ustar` со смещения 257 и имя первого элемента вида `env/<…>.env`, иначе
  `die "env-push: stdin is not the tar of the env file and the secrets"`. Затем `cat <заголовок> - | age … -o <enc>` —
  открытый текст не попадает ни в переменную, ни на диск; заголовок удаляется. Объект
  `$(offsite_prefix)/env/<имя>.tar.age`; остальное (выгрузка, сверка размера, лог) — как сейчас. Комментарии
  `env-push` и строки 24 и 288 — про архив env-файла и секретов.
- [ ] **Step 4: Пробы:** `sh -n`; в образе из задачи 2 (пересобрать): `printf 'APP_ENV=x\n' | … env-push` с
  `BACKUP_OFFSITE_BUCKET`, remote `local` и тестовым ключом `age` (`age-keygen` в образе) → отказ «not the tar»;
  `tar -cf - env/x.env secrets/x` из scratch-каталога → объект `…/env/<время>.tar.age` в каталоге-бакете, его
  расшифровка тестовым ключом и `tar -t` дают те же имена.

  Expected: как описано.
- [ ] **Step 5: Commit** `feat(backup): secrets from files, env-push sends the env file with the secrets (ADR-0021, K7, K10)`.

### Task 4: Compose, Redis, игнор-файлы, примеры env

**Files:**
- Create: `docker/compose.secrets.yml`
- Modify: `docker/compose.yml`, `docker/compose.dev.yml`, `docker/compose.backup.yml`, `docker/compose.test.yml`
  (комментарий о `psql`), `docker/redis/Dockerfile` (комментарий), `docker/env/test.env.example`,
  `docker/env/prod.env.example`, `.gitignore`, `.dockerignore`

**Interfaces:**
- Consumes: задачи 1–3 (имена переменных и скриптов).
- Produces: сервис-инструмент `secrets` (профиль `tools`, `entrypoint: [pharmacy-secrets]`); переменная `SECRETS_DIR`.

- [ ] **Step 1: `compose.yml` без секретов.** `postgres`: без `POSTGRES_PASSWORD`, `PGPASSWORD`, `PHARMACY_*_PASSWORD`.
  `redis`: команда `redis-server /usr/local/etc/redis/redis.conf --maxmemory ${REDIS_MAXMEMORY:-256mb}`, без
  `environment`; проверка `redis-cli ping 2>&1 | grep -qE 'PONG|NOAUTH'` с комментарием (K6). `migrate`:
  `MIGRATION_DATABASE_URL` без пароля. `api`: `DATABASE_URL`, `PLATFORM_DATABASE_URL` с ролью без пароля,
  `REDIS_URL: redis://redis:6379`; `SESSION_JWT_KEYS`, `PASSWORD_PEPPERS` убраны (активные id остаются). Шапка — где
  теперь секреты.
- [ ] **Step 2: `compose.dev.yml`** — прежние значения из `.env`: `postgres` (`POSTGRES_PASSWORD`, три
  `PHARMACY_*_PASSWORD` с `:?`), `redis` (команда с `--requirepass ${REDIS_PASSWORD:?…}` и `--maxmemory`), `migrate`
  (URL с паролем), `api` (URL с паролями, `SESSION_JWT_KEYS`, `PASSWORD_PEPPERS` с `:?`).
- [ ] **Step 3: `compose.secrets.yml`** — шапка (ADR-0021, кто что получает, `stack.mjs` добавляет файл сам);
  верхнеуровневые `secrets:` — десять `file: ${SECRETS_DIR:?set in the env file}/<файл>`; у сервисов `secrets:` и
  переменные:
  - `postgres`: `postgres_superuser_password`, четыре `pharmacy_*_password` → `POSTGRES_PASSWORD_FILE`,
    `PHARMACY_{OWNER,APP,PLATFORM,BACKUP}_PASSWORD_FILE`;
  - `redis`: `redis_users_acl`; команда `… --aclfile /run/secrets/redis_users_acl --maxmemory …`;
  - `migrate`: `pharmacy_owner_password`; `NODE_OPTIONS: --import=/app/scripts/secret-files.mjs`,
    `MIGRATION_DATABASE_PASSWORD_FILE`;
  - `api`: `pharmacy_app_password`, `pharmacy_platform_password`, `redis_password`, `session_jwt_keys`,
    `password_peppers`; `NODE_OPTIONS`, `DATABASE_PASSWORD_FILE`, `PLATFORM_DATABASE_PASSWORD_FILE`,
    `REDIS_PASSWORD_FILE`, `SESSION_JWT_KEYS_FILE`, `PASSWORD_PEPPERS_FILE`;
  - `backup`: `pharmacy_backup_password`, `offsite_secret_access_key`; `PGPASSWORD_FILE`,
    `RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY_FILE`;
  - `secrets`: образ `pharmacy/postgres:${IMAGE_TAG:-local}`, `pull_policy: never`, `profiles: [tools]`,
    `entrypoint: [pharmacy-secrets]`, `network_mode: none`, `read_only: true`, `cap_drop: [ALL]`,
    `cap_add: [CHOWN, DAC_OVERRIDE]`, `no-new-privileges`, том `${SECRETS_DIR:?…}:/s`.
- [ ] **Step 4: `compose.backup.yml`** — убрать `PHARMACY_BACKUP_PASSWORD` у `postgres`, `PGPASSWORD` и
  `RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY` у `backup`; комментарии — на `compose.secrets.yml`.
- [ ] **Step 5: Примеры env** test и prod — без девяти секретных переменных; `SECRETS_DIR=./secrets/<env>` с
  комментарием (K1: каталог 0700, файлы создаёт `secrets init`, в git и чаты не попадают); комментарии о ключах S3 и о
  копии env-файла — на файл `offsite_secret_access_key` и архив `env-push`; строку prod «Until an ADR selects a secret
  store» — на ADR-0021.
- [ ] **Step 6: Игнор:** `.gitignore` — `docker/secrets/`; `.dockerignore` — `docker/secrets` (контекст сборки api и
  proxy — корень). Комментарий Redis Dockerfile: test/prod — ACL из compose secrets, dev — `--requirepass`.
- [ ] **Step 7: Пробы `compose config`** (переменные — из примеров, prod — с фиктивными `ACME_EMAIL`, `OPERATOR_ALLOW`
  в окружении shell; каталогов секретов нет):
  - test: `docker compose --env-file docker/env/test.env.example -f compose.yml -f compose.backup.yml -f
    compose.secrets.yml -f compose.test.yml config` — успешно; в выводе нет `PASSWORD:`, `SESSION_JWT_KEYS:`,
    `PASSWORD_PEPPERS:`, `SECRET_ACCESS_KEY:`, `requirepass` (grep — пусто);
  - prod — то же;
  - dev: `--env-file .env.example -f compose.yml -f compose.dev.yml config` — успешно, в выводе есть `--requirepass`
    и URL с паролем (как раньше);
  - `config --profiles` для test — `tools` в списке.

  Expected: как описано.
- [ ] **Step 8: Commit** `feat(docker): compose secrets for test and prod, secret-free base compose (ADR-0021, K3, K6)`.

### Task 5: `stack.mjs`

**Files:**
- Modify: `tools/scripts/stack.mjs`

**Interfaces:**
- Consumes: `compose.secrets.yml`, сервис `secrets`, `pharmacy-psql`, `pharmacy-backup env-push` (tar на stdin).
- Produces: команды `init`, `up`, `restore`, `build`, `env-push` по K9–K11.

- [ ] **Step 1: Секретные переменные** — константа `SECRET_VARIABLES` (имя → файл): `POSTGRES_SUPERUSER_PASSWORD`,
  `PHARMACY_OWNER_PASSWORD`, `PHARMACY_APP_PASSWORD`, `PHARMACY_PLATFORM_PASSWORD`, `PHARMACY_BACKUP_PASSWORD`,
  `REDIS_PASSWORD`, `SESSION_JWT_KEYS`, `PASSWORD_PEPPERS`, `RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY` → файлы раздела 3.
  Функция `fileSecrets(env)` — имена, определённые в env-файле с непустым значением (читает только файл, не окружение
  shell). Каталог секретов — `resolve(root, 'docker', SECRETS_DIR)`.
- [ ] **Step 2: `composeArgs`** — `-f docker/compose.secrets.yml` для test и prod после `compose.backup.yml`.
  `BACKUP_VARIABLES` — без `PHARMACY_BACKUP_PASSWORD`, плюс `SECRETS_DIR`; `weakSecrets`, `PLACEHOLDER`,
  `MIN_PASSWORD_LENGTH` и проверка S2 удаляются (её заменяет `secrets check`).
- [ ] **Step 3: Отказы** — `up`, `restore` в test и prod и `build` в prod отказывают, если `fileSecrets` не пуст:
  prod — «секреты prod живут только на VPS (ADR-0021): удалите строки <имена>»; test — «запустите
  `npm run stack -- test init`: он перенесёт <имена> в <SECRETS_DIR>» (Ruling: в test тоже отказ — иначе `up` создал бы
  новый pepper, Review Focus 4).
- [ ] **Step 4: `init`** — для test после создания или дополнения env-файла: если `fileSecrets` не пуст — каталог
  `docker/<SECRETS_DIR>` (`mkdirSync` recursive, 0700); для каждой переменной файл: нет → записать значение
  (`mode: 0o444` не на Windows: там Node поставит атрибут «только чтение»); есть и равен → ничего; есть и отличается →
  отказ без изменений. Затем каждое значение перечитывается и сравнивается, и только после этого строки переменных в
  env-файле заменяются строкой `# <ИМЯ> moved to <SECRETS_DIR>/<файл> (ADR-0021)` — без значения (Ruling: спецификация
  говорит «закомментировать», но закомментированная строка хранила бы секрет в env-файле). Env-файл пишется через
  временный файл и `rename`. Печатает имена. prod: только предупреждение со списком имён.
- [ ] **Step 5: `up` и `restore`** в test и prod: `mkdirSync` каталога секретов (0700), затем
  `compose --profile tools run --rm secrets init` и `… secrets check`; роль копий —
  `exec -T postgres pharmacy-psql -q -f /docker-entrypoint-initdb.d/04-backup-role.sql`. Подсказка `restore` про
  `drop database` — через `pharmacy-psql -d postgres -c …`.
- [ ] **Step 6: `env-push`** — prod: отказ с командой для VPS (K10). test: `SECRETS_DIR` — относительный путь внутри
  `docker/` (иначе отказ); `tar -C docker -cf - env/test.env <SECRETS_DIR без ./>` (stdout — Buffer), затем
  `compose run --rm --no-deps -T backup pharmacy-backup env-push` с этим Buffer на stdin. `OFFSITE_VARIABLES` и
  `docker run`-ветка удаляются. Шапку с описанием команд обновить (`init`, `env-push`).
- [ ] **Step 7: Пробы:** `node --check tools/scripts/stack.mjs`; `node tools/scripts/stack.mjs prod build` с
  временным `docker/env/prod.env` из старого примера (`git show main:docker/env/prod.env.example`, значения-заглушки)
  → отказ со списком имён; файл удалить. Остальное — в задаче 7 (в `pharmacy-minors` команды test не запускать).

  Expected: как описано.
- [ ] **Step 8: Commit** `feat(stack): secrets of test and prod in files — init moves them, up checks them (ADR-0021, K9)`.

### Task 6: Документы

**Files:**
- Modify: `CLAUDE.md`, `docs/guides/deploy-vps.md`, `docs/architecture/stack.md`,
  `docs/architecture/adr/0008-realizaciya-autentifikacii.md`, `docs/qa/01-zapusk-do-pervogo-cheka.md`

- [ ] **Step 1: CLAUDE.md:**
  - таблица стека — строка «Хранилище секретов — файлы секретов и compose secrets, ADR-0021»;
  - «Environments»: `compose.secrets.yml` рядом с `compose.backup.yml`; обязательные пароли в env-файлах и
    предупреждение о символах в URL → каталог `SECRETS_DIR` и `secrets init/check`; абзац S2 → `secrets check` и отказ
    при секретных переменных; перенос test (`init`);
  - «Бэкапы»: env-файл и каталог секретов — архив `env-push`;
  - «Containers»: `pharmacy-psql` вместо `exec postgres psql` и `PGPASSWORD`; проверка пароля суперпользователя и шаги
    при расхождении — через `pharmacy-psql`; абзац «Пароль `pharmacy_backup` остаётся в окружении…» — закрыт;
    команды `docker compose …` с `-f docker/compose.secrets.yml`;
  - «Local development secrets» — production secrets: ADR-0021 вместо «хранилище не выбрано».
- [ ] **Step 2: `deploy-vps.md`** (K12–K14, разделы 4–5 спецификации):
  - вступление: на хосте ещё каталог секретов; `dc()` — с `compose.secrets.yml`; раздел 3 и откат (раздел 7) копируют
    и `compose.secrets.yml`; новый подраздел «Секреты на VPS» (`install -d -m 700`, `dc --profile tools run --rm secrets
    init`, ключ S3 через `read -rs` в `offsite_secret_access_key` 0444, `check`);
  - раздел 2: env-файл без секретов; раздел 2.1, шаги 5–6: ключ S3 — в файл на VPS, `env-push` — командой на VPS;
  - шаг 4 и «Восстановление из копии»: `pharmacy-psql`;
  - «Новый сервер» и «После взлома»: архив `<время>.tar.age`, расшифровка образом `pharmacy/postgres` от пользователя
    `deploy` (`--user "$(id -u):$(id -g)"`, ключ на stdin) с `tar -x` в `/opt/pharmacy/docker`, затем права K1; полные
    команды `docker compose` — с `compose.secrets.yml`;
  - новый раздел «Ротация секретов» — процедуры раздела 5 спецификации, после каждой — `env-push`;
  - новый раздел «Доступ» — K12.
- [ ] **Step 3:** stack.md, вопрос № 8 и строка таблицы «Где хранятся секреты» — закрыт ADR-0021; ADR-0008, строки 163,
  208, 287 — «из переменных окружения, пока ADR…» → ссылка на ADR-0021 (облако; офлайн-точка — как было);
  `docs/qa/01` — `init` создаёт env-файл без секретов, секреты создаёт `up` в `docker/secrets/test`, перенос старого
  env-файла — `init`.
- [ ] **Step 4: Проверка:** `grep -rn 'PGPASSWORD\|exec -T postgres psql\|exec postgres psql\|POSTGRES_PASSWORD"'
  CLAUDE.md docs/guides docs/qa docker` — только намеренные места; ссылки на разделы руководства существуют.
- [ ] **Step 5: Commit** `docs: secret store — CLAUDE.md, deploy guide, stack.md, ADR-0008, QA launch (ADR-0021, K14)`.

### Task 7: Живая проверка (K15)

Временный worktree `C:\Projects\AI Projects\pharmacy-secretcheck` от HEAD ветки, **без `node_modules` и junction**;
локальные незакоммиченные правки только в нём: имя проекта test в `stack.mjs` → `pharmacy-secretcheck`, в
`compose.test.yml` у `backup` — том каталога-бакета для remote `local`. Порты env-файла: API 3190, PostgreSQL 5493,
proxy 8090/8493; `AUTH_TEST_COOKIES=true`; `BACKUP_DIR` — scratch-каталог. Образы — `docker compose build api postgres
redis` с тегом, который вычислит `stack.mjs` (`<sha>-dirty`); proxy не нужен: `stack test up postgres redis migrate api
backup`. Учётные данные — синтетические, в scratchpad.

- [ ] **Step 1: Перенос (K11).** Стенд старого формата: env-файл по примеру из `main` (секреты в env-файле), образы
  `pharmacy/{api,postgres,redis}:0e75ec6` и compose-файлы `main` (`docker compose` напрямую, тот же project);
  оператор (`create-operator.mjs`) и активация по API, вход — сохранить cookie-проверку. Затем в worktree ветки:
  `stack test up` → отказ «запустите init» (Review Focus 4); `stack test init` → девять файлов, строки env-файла
  заменены комментариями, повторный `init` ничего не меняет; `up` → все healthy; вход оператора прежним паролем — 200
  (pepper и пароли ролей прежние); `backup` → копия проверена.
- [ ] **Step 2: Утечки.** Скрипт в scratchpad читает файлы каталога секретов и ищет каждое значение длиной ≥ 8 в выводе
  `docker inspect` всех контейнеров проекта, `docker compose config` (test) и `docker top` каждого контейнера;
  печатает только число совпадений по файлам. Expected: 0 у всех. `docker top <redis>` — без `requirepass`.
- [ ] **Step 3: Работа сервисов:** миграции (`logs migrate`), `api` healthy, вход оператора; Redis без пароля —
  `NOAUTH`; с паролем — одноразовый контейнер образа `pharmacy/redis` в сети проекта с файлом `redis_password`,
  смонтированным только для чтения, `REDISCLI_AUTH="$(cat …)" redis-cli -h redis ping` — `PONG`; `backup-status`; remote `local`: копия выгружена, `offsite-list`; `stack test env-push` → объект
  `test/env/<время>.tar.age`, расшифровка тестовым ключом и `tar -t` — env-файл и десять файлов секретов;
  `restore <копия>` (план) и `restore <копия> --replace-database` → стек снова healthy, вход работает.
- [ ] **Step 4: Свежий стенд:** `down -v`, удалить env-файл и каталог секретов, `init` → `up` → секреты созданы
  `secrets init`, все healthy, `check` ok, утечки (шаг 2) — 0.
- [ ] **Step 5: Linux-семантика (Review Focus 5):** том Docker, корень `chown 1000:1000`, `chmod 700`;
  `docker run --rm -v <том>:/s --cap-drop ALL --cap-add CHOWN --cap-add DAC_OVERRIDE --entrypoint pharmacy-secrets
  pharmacy/postgres:<тег> init` → у файлов владелец 1000:1000 и права 0444 (`stat` в alpine), `check` ok.
- [ ] **Step 6: prod-отказы:** `stack prod build` и `stack prod env-push` с временным prod.env — отказы из задачи 5.
- [ ] **Step 7: Уборка:** `down -v` проекта `pharmacy-secretcheck`, образы `<sha>-dirty` и `secretprobe`, том пробы,
  scratch-каталоги; worktree удалить (`git worktree remove --force` — junction в нём нет). Итог проверок — в ledger;
  ошибки — исправления в ветке с отдельными коммитами `fix:` и повтор затронутых шагов.
