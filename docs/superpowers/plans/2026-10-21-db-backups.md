# Резервное копирование облачной БД: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** в test и prod каждую ночь делается проверенная восстановлением копия базы; копии хранятся 30 дней; отсутствие
копии видно по `unhealthy`; база восстанавливается одной командой `stack restore`, в том числе после потери диска.

**Architecture:**
- Один POSIX sh-скрипт `pharmacy-backup` в образе `pharmacy/postgres`:
  - копия — в контейнере `backup` по TCP ролью `pharmacy_backup`;
  - проверка — во временном экземпляре в `/scratch`;
  - восстановление — в контейнере `postgres` через локальный сокет суперпользователем.
- Общие функции восстановления (`apply_globals`, `restore_into`, `check_restored`) использует и проверка, и настоящее
  восстановление, поэтому проверка повторяет процедуру (B4).
- `stack.mjs` подключает `docker/compose.backup.yml` для test и prod, при `up` создаёт роль до старта остальных
  сервисов, оркестрирует `restore`.

**Tech Stack:** PostgreSQL 17.11 (`pg_dump`, `pg_dumpall`, `pg_restore`, `initdb`, `pg_ctl` из образа), busybox sh
(`flock`, `date -d`), Docker Compose (Engine ≥ 25), Node (`tools/scripts/stack.mjs`). Новых зависимостей нет.

**Spec:** `docs/superpowers/specs/2026-10-21-db-backups-design.md` (B1–B16, разделы 3–8), ADR-0019.

## Global Constraints

- Тесты отложены до MVP — живая проверка; существующие наборы зелёные. Полный прогон (`npm run check`,
  `npm run stack -- test build`) запускает пользователь.
- Ветка `feature/db-backups` (`--no-track origin/main`); спецификация уже закоммичена, план — следующим коммитом.
- Без согласия пользователя:
  - не поднимать стек test и не создавать новые контейнеры;
  - не менять `docker/env/test.env`;
  - не удалять тома.

  Проверки задачи 1 — внутри уже работающего `pharmacy-dev-postgres-1` (`docker exec`, `MSYS_NO_PATHCONV=1`). Роль и
  базы, созданные на dev для проверок, удаляются в конце задачи.
- Пароли генерируются в скриптах проверки и нигде не печатаются; в логах скрипта паролей нет.
- Значения из спецификации:
  - `BACKUP_TIME` = `02:00`, `TZ=Asia/Dushanbe`; `BACKUP_RETENTION_DAYS` = 30 (в примере test — 7);
  - unhealthy без проверенной копии > 26 ч, кроме первых 2 ч жизни контейнера; повтор после неудачи — через 1 ч;
  - `pg_dump -Fc --lock-wait-timeout=60s`; `pg_restore -j 2 --exit-on-error`;
  - роль: `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS CONNECTION LIMIT 2`, член `pg_read_all_data`;
  - healthcheck: `interval: 5m`, `timeout: 30s`, `retries: 1`, `start_period: 1m`, `start_interval: 5s`;
  - папки 0700, файлы 0600; имя копии — `date -u +%Y%m%dT%H%M%SZ`;
  - прежняя база — `<db>_before_<имя копии в нижнем регистре>`.
- Коммиты `--no-gpg-sign`, Conventional Commits, `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; prettier —
  только на изменённые `.mjs` и `.md`.

## Review Focus

1. **Копия прервана посреди `pg_dump`** (выкладка пересоздала `postgres`/`backup`). Ожидается: `.partial` не
   считается копией и удаляется следующим запуском; повтор не позже чем через час. Проверка — задача 3, t5.
2. **`BACKUP_DIR` недоступен на запись** (на Linux не тот владелец, на Windows опечатка в пути). Ожидается: одна
   понятная строка в логе с командой `install -d -o 70 -g 70 -m 700 <dir>`, контейнер сразу unhealthy, без цикла
   падений. Проверка — задача 1, c7.
3. **Копия не удалась, а проверенные копии есть.** Ожидается: создаётся `.failed` с причиной, ни одна проверенная
   копия не удалена (удаление по сроку — только после успеха), health остаётся healthy, пока последней проверенной
   меньше 26 ч. Проверка — задача 1, c5.
4. **Повторное или прерванное восстановление.** Та же копия второй раз: отказ до остановки сервисов, потому что
   `<db>_before_<имя>` уже есть. Остаток `pharmacy_restore` от упавшей попытки удаляется. Рабочая база не тронута.
   Проверка — задача 3, t7, t8.
5. **Время расписания уже прошло сегодня или контейнер перезапущен после пропущенной ночи.** Ожидается: следующий
   запуск — завтра в `BACKUP_TIME`; если проверенной копии за 24 ч нет — сразу. `status` показывает запланированное
   время. Проверка — задача 3, t4.

---

### Task 1: Скрипт `pharmacy-backup` и роль копирования

**Files:**
- Create: `docker/postgres/backup/pharmacy-backup` (POSIX sh, LF — по `.gitattributes`).
- Create: `docker/postgres/initdb/04-backup-role.sql`.
- Modify: `docker/postgres/Dockerfile`:
  - `COPY --chmod=0755 backup/pharmacy-backup /usr/local/bin/`;
  - `RUN install -d -o postgres -g postgres -m 700 /backups /scratch` — именованный том `backup-scratch` наследует
    владельца из образа.
- Scratchpad: `bk_task1.sh`.

**Interfaces — Produces (используют задачи 2 и 3):**
- **Подкоманды `pharmacy-backup`:**
  - `daemon` — расписание B5;
  - `run` — коды выхода: 0 — копия проверена, 1 — неудача, 2 — отказ защиты или каталог недоступен, 3 — копия уже идёт;
  - `verify <имя>` — 0 или 1, манифест не меняет;
  - `status` — список копий, последняя проверенная, следующий запуск, причина блокировки;
  - `health` — 0 или 1;
  - `restore <имя> --check` — 0, если можно восстанавливать, иначе 1 с причиной; ничего не меняет;
  - `restore <имя>` — шаги 3–4 B9.
- **Окружение:**
  - `BACKUP_ROOT` (по умолчанию `/backups`), `SCRATCH` (`/scratch`), `BACKUP_TIME`, `BACKUP_RETENTION_DAYS`, `TZ`,
    `IMAGE_TAG`;
  - для `run` — `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`;
  - `restore` подключается к `/var/run/postgresql` пользователем `$POSTGRES_USER`, база — `$POSTGRES_DB`.
- **Состояние:**
  - `$BACKUP_ROOT/.state/started`, `next` — эпоха;
  - `$BACKUP_ROOT/.state/blocked` — причина;
  - блокировка `flock` — на `/tmp/pharmacy-backup.lock`, локально в контейнере `backup`: bind-mount Docker Desktop
    `flock` не гарантирует.
- **Манифест:** одна пара ключ–значение на строку, чтобы его читал `sed`. Поля: `name`, `startedEpoch`, `startedAt`,
  `finishedEpoch`, `finishedAt`, `imageTag`, `serverVersion`, `dumpBytes`, `dumpSeconds`, `restoreSeconds`, `tables`,
  `lastMigration`, `tenants`, `verified` (`true`/`false`), `error`. Строка `error` очищается от `"` и `\` и
  обрезается до одной строки.

- [ ] **Step 1: `04-backup-role.sql`.** Шапка — как у `03-provisioner-role.sql`: когда и как его запускают.
  1. `\getenv backup_pw PHARMACY_BACKUP_PASSWORD`; дальше всё внутри `\if :{?backup_pw}` … `\endif`.
  2. `select 'create role pharmacy_backup' where not exists (…) \gexec`.
  3. `select format('alter role pharmacy_backup with login nosuperuser nocreatedb nocreaterole bypassrls connection limit 2 password %L', :'backup_pw') \gexec`.
  4. `grant pg_read_all_data to pharmacy_backup`.

  В комментарии — почему `\gexec`: переменные psql в `DO` не подставляются. Там же — что пароль попадает в лог
  сервера только при `log_statement` ≥ `ddl` или при ошибке оператора.
- [ ] **Step 2: Скрипт.** Функции и правила, которые нельзя выбрать иначе:
  - **`log`** — `date -u +%FT%TZ` и текст, в stdout.
  - **`preflight`** (в начале `run` и `daemon`, и каждый час, пока есть блокировка):
    - `BACKUP_ROOT` не пишется → `blocked` с причиной и командой `install -d -o 70 -g 70 -m 700 <dir>`;
    - защита B15 → `blocked`: сетей 0 (нет таблицы `pharmacy.tenants` — тоже 0), а среди проверенных манифестов есть
      `tenants` > 0;
    - иначе `blocked` удаляется.
  - **`run`**:
    1. `flock -n` (иначе выход 3); `preflight` (иначе выход 2).
    2. Удалить все `*.partial`: под блокировкой это всегда остаток прерванного запуска.
    3. Источник: таблицы `relkind in ('r','p')` в `pharmacy` и `public`, последняя миграция (`public.pgmigrations`
       по `id desc`; нет таблицы — пусто), `server_version`, сети.
    4. `pg_dumpall --globals-only --no-role-passwords` → `globals.sql`; `pg_dump` → `pharmacy.dump`; `umask 077`.
    5. `verify_dir`, манифест, переименование `.partial` → `<имя>` или `<имя>.failed`.
    6. После успеха — `retention`.
  - **`verify_dir <dir>`**:
    1. `initdb -D $SCRATCH/data -U postgres --auth=trust`.
    2. `pg_ctl … -o "-c listen_addresses='' -c unix_socket_directories=$SCRATCH -p 5499 -c fsync=off -c full_page_writes=off -c max_parallel_maintenance_workers=0" -w start`.
    3. `apply_globals`; `restore_into pharmacy`; `check_restored`.
    4. Остановка `-m fast` и очистка `$SCRATCH` — в `trap` при любом исходе.
  - **`apply_globals <conn>`**:
    - строки про роль `postgres` пропускаются;
    - `CREATE ROLE x;` переписывается `sed` в `SELECT 'CREATE ROLE x' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'x')\gexec`;
    - запуск с `ON_ERROR_STOP=1`.
  - **`restore_into <conn> <db> <dump>`** — `create database <db> owner pharmacy_owner`, затем
    `pg_restore -j 2 --exit-on-error -d <db>`.
  - **`check_restored <conn> <db> <manifest-or-source>`** — таблицы и миграция совпадают; возвращает число сетей.
  - **`retention`**:
    - проверенные копии (имя по маске `^[0-9]{8}T[0-9]{6}Z$`, `verified true`) старше `BACKUP_RETENTION_DAYS` удаляются,
      кроме самой свежей проверенной;
    - `*.failed` старше суток удаляются;
    - чужие имена не трогаются.
  - **`daemon`**:
    1. Записать `started`; `preflight`.
    2. Нет проверенной копии за 24 ч → запуск сейчас, иначе следующий слот: `date -d "$BACKUP_TIME" +%s`, а если он
       уже прошёл — плюс 86400; перехода на летнее время в Душанбе нет.
    3. После `run`: 0 → следующий слот; 1 → `min(now + 3600, слот)`; 2 → через 3600 и снова `preflight`.
    4. Время следующего запуска пишется в `next`.
  - **`health`**:
    - `blocked` есть → 1;
    - проверенная копия моложе 26 ч → 0;
    - `started` моложе 2 ч → 0;
    - иначе 1.
  - **`status`**:
    - строки копий: имя, время по `TZ` (`date -d @epoch`), размер в МБ, `verified`/`FAILED`/`partial`, длительности,
      миграция, сети;
    - итог: возраст последней проверенной, следующий запуск, причина блокировки.
  - **`restore <имя> [--check]`**:
    - `--check` отказывает, если: копии нет; `verified` не `true`; уже есть `<db>_before_<имя>`.
    - Без флага: `drop database if exists pharmacy_restore`; `apply_globals`; `restore_into pharmacy_restore`;
      `check_restored` против манифеста. При ошибке — `drop database pharmacy_restore` и выход 1.
    - Затем: `alter database <db> allow_connections false`; `pg_terminate_backend` по `<db>`; переименования. Если
      `<db>` нет, только второе переименование.
- [ ] **Step 3: Живая проверка в dev-контейнере** (`bk_task1.sh`):
  - скрипт и `04` копируются в `/tmp`;
  - роль создаётся `docker exec -e PHARMACY_BACKUP_PASSWORD=<случайный> … psql -f /tmp/04-backup-role.sql`;
  - запуск: `docker exec -u postgres -e PGHOST=127.0.0.1 -e PGUSER=pharmacy_backup -e PGPASSWORD=… -e BACKUP_ROOT=/tmp/bk -e SCRATCH=/tmp/bks -e TZ=Asia/Dushanbe`.

  | Шаг | Действие | Ожидается |
  |---|---|---|
  | c1 | `04` дважды подряд; `\du pharmacy_backup` | без ошибок; BYPASSRLS, limit 2, член `pg_read_all_data` |
  | c2 | `run` | выход 0; папка `<имя>` с тремя файлами, `verified true`, `tables` 125, `tenants` > 0; длительности записаны; права 0700/0600 |
  | c3 | `status`, `health` | копия видна с временем по Душанбе; `health` 0 |
  | c4 | два `run` одновременно | один — 0, другой — 3 |
  | c5 | `run` с неверным паролем | выход 1; `<имя>.failed` с `error`; прежняя проверенная копия цела; `health` 0 |
  | c6 | пустая база `bk_guard_probe` (суперпользователем) как `PGDATABASE`: (а) при копиях c2 → выход 2, `blocked`, `health` 1; (б) с пустым `BACKUP_ROOT` → копия делается (первый запуск среды), `tenants` 0 | как написано |
  | c7 | `BACKUP_ROOT` с `chmod 500` | выход 2; в логе причина и команда `install -d …`; `health` 1 |
  | c8 | подложить копию c2 с `startedEpoch` −40 дней и `.failed` −2 дня; `run`; затем `BACKUP_RETENTION_DAYS=0` и `run` | старые удалены; при 0 остаётся ровно самая свежая проверенная |
  | c9 | манифест с `finishedEpoch` −27 ч и `started` −3 ч | `health` 1 |
  | c10 | `verify <имя c2>`; испорченная копия (обрезанный `pharmacy.dump`) | 0; 1 с причиной |

  Expected: всё по таблице. Уборка: `drop role pharmacy_backup`, `drop database bk_guard_probe`, `rm -rf` в `/tmp`
  контейнера.
- [ ] **Step 4: Коммит:** `feat(docker): the backup script and the read-only backup role (ADR-0019)`.

### Task 2: Сервис `backup` и команды `stack.mjs`

**Files:**
- Create: `docker/compose.backup.yml`.
- Modify:
  - `docker/compose.test.yml`, `docker/compose.prod.yml` — лимиты `backup`: test — `0.5` CPU / `512m`, prod — `1` /
    `1g`;
  - `docker/env/test.env.example`, `docker/env/prod.env.example`;
  - `tools/scripts/stack.mjs`.

**Interfaces:**
- Consumes: подкоманды и коды выхода задачи 1.
- Produces: `npm run stack -- <test|prod> backup | backup-status | backup-verify <имя> | restore <имя> [--replace-database]`;
  `up` для test и prod создаёт роль до остальных сервисов.

- [ ] **Step 1: `compose.backup.yml`.**
  - **`postgres`** (дополняет базовый):
    - `PHARMACY_BACKUP_PASSWORD: ${PHARMACY_BACKUP_PASSWORD:?set in the env file}`;
    - том `${BACKUP_DIR:?set in the env file}:/backups:ro`.

    Отступление от раздела 3 спецификации: переменная здесь, а не в базовом `compose.yml`. Результат тот же — dev её
    не требует, — а базовый файл не меняется.
  - **`backup`**:
    - `image: pharmacy/postgres:${IMAGE_TAG:-local}`, `user: postgres`, `init: true` (SIGTERM доходит до `sleep`),
      `command: ['pharmacy-backup', 'daemon']`;
    - окружение из раздела 3 спецификации плюс `PGPORT: 5432`;
    - тома `${BACKUP_DIR}:/backups` и `backup-scratch:/scratch`;
    - `shm_size: 256mb`, `restart: unless-stopped`, `depends_on: postgres: service_healthy`;
    - healthcheck: `['CMD', 'pharmacy-backup', 'health']` со значениями из Global Constraints;
    - блок `logging` — как в базовом файле (якоря между файлами не работают).
  - Том `backup-scratch`.
- [ ] **Step 2: Примеры env-файлов.**
  - Добавить `PHARMACY_BACKUP_PASSWORD=change-me`, `BACKUP_DIR`, `BACKUP_TIME=02:00`, `BACKUP_RETENTION_DAYS`
    (test — 7, prod — 30).
  - `BACKUP_DIR`: `/srv/pharmacy-backups/<env>`; в комментарии — отдельный диск или сетевой том, команда `install -d`
    для Linux и пример `C:/pharmacy-backups/<env>` для Docker Desktop.
- [ ] **Step 3: `stack.mjs`.**
  - `composeArgs`: для test и prod — `-f docker/compose.backup.yml` перед `compose.<env>.yml`.
  - Новые команды — только test и prod, иначе `fail`; описание в шапке файла.
  - **`up`** (test, prod):
    1. `up -d --no-build --wait postgres`.
    2. `exec -T postgres sh -c 'psql -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /docker-entrypoint-initdb.d/04-backup-role.sql'`.
    3. `up -d --no-build --wait [services]`, затем `ps`.
  - **`backup`** — `exec -T backup pharmacy-backup run`; коды 2 и 3 → понятные сообщения, иначе `fail`.
  - **`backup-status`** — `exec -T -u postgres -e TZ=Asia/Dushanbe postgres pharmacy-backup status`. Работает, даже
    когда поднят только `postgres` (раздел 3.1).
  - **`backup-verify <имя>`** — `exec -T backup pharmacy-backup verify <имя>`.
  - **`restore <имя>`**:
    1. Всегда сначала `restore <имя> --check` в `postgres` (`-u postgres`). Без `--replace-database` — напечатать
       шаги B9 и выйти.
    2. С флагом: `stop api backup` → `exec … restore <имя>`.
    3. Неудача → `up -d --no-build --wait api backup` и `fail`.
    4. Успех → `restart redis` → последовательность `up` (все сервисы).
    5. Напечатать: имя прежней базы и команду её удаления (`compose … exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d postgres -c "drop database …"'`);
       предупреждение B10 о pepper; что все сессии сброшены.
- [ ] **Step 4: Проверка без контейнеров.**
  - `node --check tools/scripts/stack.mjs`.
  - `docker compose … config --quiet` для dev (`.env`), а для test и prod — с `--env-file docker/env/<env>.env.example`
    и обоими дополнительными файлами.
  - `node tools/scripts/stack.mjs dev backup` → отказ «только test и prod».

  Expected: exit 0 у трёх рендеров; отказ у dev.
- [ ] **Step 5: Коммит:** `feat(stack): the backup service and the backup, status, verify and restore commands`.

### Task 3: Живая проверка на стеке test, документы

**Files:**
- Modify:
  - `CLAUDE.md`:
    - строка «Резервное копирование» в таблице стека (ADR-0019);
    - в «Environments» — команды и раздел «Бэкапы»: ежедневная проверка `ps` и `backup-status`, восстановление,
      потеря диска (раздел 3.1 спецификации), отдельная копия env-файла, без ручных миграций в окне копии, каталог на
      Linux;
    - в «Containers» — роль `pharmacy_backup` и `04-backup-role.sql`, который запускает `up`, скрипт в образе;
  - `docs/architecture/stack.md`: строка объёма — способ ADR-0019; шифрование и копия вне хоста — открыто с вопросом
    № 1;
  - `docs/architecture/c4/deployment.md`, `deployment.mmd`: контейнер `backup` на VM БД, `BACKUP_DIR`, проверка
    восстановления. PNG перегенерировать, если в репозитории есть способ без новых загрузок; иначе — отметка в PR.
- Scratchpad: `bk_test.sh`.

- [ ] **Step 1: Согласие пользователя** — одним сообщением, до любых действий со стеком test:
  1. `npm run stack -- test init` — добавит в `docker/env/test.env` четыре переменные, печатает только имена.
  2. Путь `BACKUP_DIR` для Windows в `test.env` (предложить `C:/pharmacy-backups/test`) — правит пользователь или я
     с его согласия.
  3. Пользователь запускает `npm run stack -- test build` (это полный гейт).
  4. Я поднимаю стек test.
  5. Для t9 — удаление тома `pharmacy-test_pg-data`.

  Если в базе test нет сетей, её наполняет восстановление проверенной dev-копии из задачи 1: данные синтетические, а
  заодно это проверка восстановления на другой кластер.

  Итерации по скрипту: `IMAGE_TAG=<тег> docker compose … build postgres` и
  `docker tag pharmacy/api:<собранный> pharmacy/api:<тег>`.
- [ ] **Step 2: Сценарии** (`bk_test.sh`):

  | Шаг | Действие | Ожидается |
  |---|---|---|
  | t1 | `stack test up` на существующем кластере | роль создана до остальных сервисов; `backup` сразу делает копию; `ps` — healthy; `backup-status` — копия и следующий запуск в 02:00 |
  | t2 | повторный `up`; `PHARMACY_BACKUP_PASSWORD=<новый> stack test up`, затем `stack test backup`; потом `up` без переопределения | без ошибок; копия под новым паролем проходит; возврат пароля проходит |
  | t3 | два `stack test backup` одновременно | одна копия, второй — «копия уже идёт» |
  | t4 | `BACKUP_TIME=<сейчас+3 мин> stack test up`; ждать; затем `BACKUP_TIME=<прошедшее время>` | `next` = через 3 мин, копия появилась; затем `next` — завтра |
  | t5 | `stack test backup` в фоне, во время `pg_dump` — `docker compose … restart backup` | `.partial` остался; следующий запуск его удалил; копией он не считался |
  | t6 | после копии: `create table pharmacy.restore_marker()` суперпользователем; открыть диагностический `psql` с `pg_sleep(600)` на базе; `restore <копия>` без флага, затем с `--replace-database` | без флага ничего не меняется; с флагом: маркера нет, число сетей прежнее, `redis-cli dbsize` 0, `pharmacy_before_<имя>` с `datallowconn = false`, диагностическая сессия завершена; `api` и `backup` healthy; длительность восстановления записана |
  | t7 | копия с обрезанным `pharmacy.dump` (манифест `verified true`) → `restore --replace-database` | ошибка `pg_restore`; `pharmacy_restore` удалена; рабочая база цела; `api` и `backup` снова запущены |
  | t8 | `restore` той же копии, что в t6 | отказ на `--check`, до остановки сервисов |
  | t9 | (согласие) `down`, `docker volume rm pharmacy-test_pg-data`, полный `up` | защита B15: `backup` unhealthy, копий не прибавилось, в логе причина; `backup-status` работает; `restore … --replace-database` возвращает данные; `stack test backup` проходит, `health` 0 |
  | t10 | подложить проверенную копию −10 дней и `.failed` −2 дня (test: срок 7); `stack test backup` | обе удалены |
  | t11 | права файлов внутри контейнера | записать, что видно на Docker Desktop; проверка 0600/0700 — на Linux-хосте (B16) |

- [ ] **Step 3: Документы** — по списку Files. Числа RTO берутся из манифестов t1 и t6.
- [ ] **Step 4: Наборы:** пользователь запускает `npm run check`. Кода TypeScript PR не меняет, поэтому достаточно
  результата пользователя.
- [ ] **Step 5: Коммит:** `docs: backups — environments, containers, deployment, stack (ADR-0019)`.
