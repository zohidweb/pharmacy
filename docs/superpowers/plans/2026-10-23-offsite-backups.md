# Копии БД вне сервера — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** каждая проверенная копия БД (ADR-0019) шифруется `age` и в течение часа уходит `rclone` во внешнее
хранилище; её можно найти, проверить и восстановить оттуда без исходного сервера.

**Architecture:** всё внутри существующего POSIX-скрипта `pharmacy-backup` (образ `pharmacy/postgres`, сервис
`backup`): выгрузка после успешного `run` и раз в час из демона, состояние — `offsite.json` у копии и `$STATE/offsite`.
Скачивание и учебная проверка получают закрытый ключ только через stdin. `stack.mjs` добавляет команды-обёртки,
документы — порядок настройки бакета и восстановления.

**Tech Stack:** POSIX sh (busybox), `age`, `rclone` (пакеты Alpine), Docker Compose, Node.js (`stack.mjs`).

**Spec:** `docs/superpowers/specs/2026-10-23-offsite-backups-design.md` (O1–O16), ADR-0020 и его поправка 2026-10-23,
ADR-0019 / `2026-10-21-db-backups-design.md` (B1–B16).

## Global Constraints

- Объект копии: `<APP_ENV>/<копия>.tar.age` (O1); копии env-файла: `<APP_ENV>/env/<UTC YYYYmmddTHHMMSSZ>.env.age` (O13).
- Получатели — `BACKUP_AGE_RECIPIENTS`, открытые ключи `age1…` через пробел; закрытых ключей на сервере нет (O2).
- rclone настраивается только переменными `RCLONE_CONFIG_OFFSITE_*`, удалённое хранилище называется `offsite`; без
  `rclone.conf` на сервере (O6). Выгрузка включена, только если задан `BACKUP_OFFSITE_BUCKET`.
- Сервер ничего не удаляет во внешнем хранилище (O4): ни `rclone delete`, ни `purge`, ни `sync`.
- Здоровье: при включённой выгрузке unhealthy, если свежайшая выгруженная копия старше 26 ч после первых 2 ч
  контейнера; при `APP_ENV=prod` без выгрузки — unhealthy (O9). test без выгрузки — как сейчас.
- Ключи, секреты и ответы хранилища целиком в лог не пишутся; закрытый ключ не касается диска (stdin, O11).
- Неудача выгрузки не меняет код выхода `run` и не делает копию плохой (O8).
- Тесты отложены до MVP: новых автотестов нет; каждая задача проверяется вживую (O16). Полный `npm run check`
  запускает пользователь. Коммиты — `--no-gpg-sign`, Conventional Commits.

## Review Focus

1. **Object Lock требует Content-MD5.** S3 отклоняет PutObject в бакет с Object Lock без контрольной суммы;
   rclone для файлов меньше `upload_cutoff` (200 MiB) шлёт MD5. Копия больше 200 MiB уйдёт multipart — нужен прогон
   на настоящем бакете (задача 6, шаг на реальном бакете) или `RCLONE_CONFIG_OFFSITE_UPLOAD_CUTOFF` выше размера копии.
2. **Корень только для чтения.** rclone пишет конфиг и кэш в `$HOME`; в `backup` корень read-only — каталоги rclone
   должны указывать на `/tmp` (tmpfs), иначе выгрузка падает «read-only file system».
3. **Копия уже есть локально** при `fetch` — отказ, а не перезапись проверенной копии.
4. **Неверный или чужой ключ** при `fetch`/`verify-offsite` — понятная ошибка `age`, без частичного каталога копии.
5. **Прерванная выгрузка** (перезапуск контейнера в середине) — нет `offsite.json`, следующий час выгружает заново;
   объект с тем же именем под Object Lock перезаписать нельзя → `copyto` должен сначала проверять, нет ли объекта
   того же размера (`rclone lsjson`), и считать его выгруженным.

---

### Task 1: Инструменты и переменные

**Files:**
- Modify: `docker/postgres/Dockerfile` — `apk add --no-cache age rclone` после копирования скрипта.
- Modify: `docker/compose.backup.yml` — в `backup.environment`: `APP_ENV: ${APP_ENV:?set in the env file}`,
  `BACKUP_OFFSITE_BUCKET: ${BACKUP_OFFSITE_BUCKET:-}`, `BACKUP_AGE_RECIPIENTS: ${BACKUP_AGE_RECIPIENTS:-}`,
  `RCLONE_CONFIG_OFFSITE_TYPE`, `_PROVIDER`, `_ENDPOINT`, `_ACCESS_KEY_ID`, `_SECRET_ACCESS_KEY`,
  `_FORCE_PATH_STYLE` — все `${…:-}`; `RCLONE_CONFIG: /tmp/rclone.conf`, `RCLONE_CACHE_DIR: /tmp/rclone-cache`.
- Modify: `docker/env/test.env.example`, `docker/env/prod.env.example` — раздел «Копии вне хоста (ADR-0020)» с
  переменными спецификации §4 (значения пустые, в prod — подсказки endpoint `usc1`/`sin1`, провайдер `Ceph`,
  path-style `true`).

- [ ] **Step 1:** внести изменения.
- [ ] **Step 2: Проверка.** `docker compose … -f compose.backup.yml config -q` для test и prod (временные env, как в
  прошлых ветках) — без ошибок; `docker build -f docker/postgres/Dockerfile docker/postgres` и
  `docker run --rm --pull=never <образ> sh -c 'age --version && rclone version | head -1'` — обе версии печатаются.
- [ ] **Step 3: Commit** `feat(docker): age and rclone in the postgres image, the offsite variables of backup`.

### Task 2: Выгрузка — `push`, состояние, здоровье

**Files:** Modify `docker/postgres/backup/pharmacy-backup`.

**Interfaces:**
- Produces: `offsite_enabled()` → 0, если задан `BACKUP_OFFSITE_BUCKET`; `offsite_object <name>` → печатает
  `offsite:$BACKUP_OFFSITE_BUCKET/$APP_ENV/<name>.tar.age`; `offsite_push` (под уже взятой блокировкой 9) — выгружает
  невыгруженные проверенные копии моложе `RETENTION_DAYS` от свежей к старой, возвращает 0 если все выгружены;
  `cmd_push` — берёт блокировку и вызывает `offsite_push`. Файл копии `<копия>/offsite.json`:
  `{"object": "<путь>", "bytes": N, "uploadedAt": "<UTC ISO>"}`; файл `$STATE/offsite`: одна строка
  `configured <bucket>` | `disabled` | `error <время UTC> <причина без секретов>`.

- [ ] **Step 1:** функции выше. Шифрование: `tar -C "$dir" -cf - pharmacy.dump globals.sql manifest.json | age $(for r
  in $BACKUP_AGE_RECIPIENTS; do printf -- '-r %s ' "$r"; done) -o "$SCRATCH/<name>.tar.age"`; до этого проверить, что
  каждый получатель начинается с `age1`. Перед `rclone copyto` — `rclone lsjson <объект>`: объект того же размера уже
  есть → считать выгруженным (Review Focus 5). После `copyto` — снова `lsjson`, размер совпадает → `offsite.json`.
  Временный файл в `$SCRATCH` удаляется в любом исходе.
- [ ] **Step 2:** `cmd_run` после `retention` вызывает `offsite_push` (ошибка — в лог, `exit 0` сохраняется);
  `cmd_daemon` — переменная `next_push`: в цикле ожидания, когда `now ≥ next_push` и выгрузка включена,
  `"$0" push`, затем `next_push=$((now + RETRY))`; первый `next_push` — через час после старта.
- [ ] **Step 3:** `cmd_health`: при включённой выгрузке — unhealthy, если свежайший `offsite.json` (`uploadedAt`)
  старше `HEALTHY_AGE` и прошло больше `GRACE` с запуска; при `APP_ENV=prod` и выключенной выгрузке — exit 1.
  `cmd_status` (запускается в `postgres`, без переменных выгрузки): колонка `offsite` (`yes`/пусто) по
  `offsite.json`, строка «newest offsite copy: …» и содержимое `$STATE/offsite`.
- [ ] **Step 4:** `case` — `push) cmd_push ;;`, строка usage.
- [ ] **Step 5: Проверка** (задача 6 гоняет всё вместе): `sh -n` скрипта; `shellcheck`, если есть в образе — иначе
  пропустить.
- [ ] **Step 6: Commit** `feat(backup): copies off the host — encrypted with age, uploaded with rclone (ADR-0020)`.

### Task 3: Список, скачивание, учебная проверка, копия env-файла

**Files:** Modify `docker/postgres/backup/pharmacy-backup`.

**Interfaces:**
- Consumes: `offsite_enabled`, `offsite_object`, `restore_into`, `check_restored`, `scratch_start/stop`, `apply_globals`.
- Produces (все требуют включённой выгрузки, иначе `die`):
  - `list-offsite` — имена копий во внешнем хранилище для `$APP_ENV` (по `rclone lsf`), по одному в строке, и
    объекты env-файла;
  - `fetch <name>` — ключ из stdin (`age -d -i /dev/stdin`); копия в `$BACKUP_ROOT/<name>` уже есть → `die`;
    скачать в `$SCRATCH`, расшифровать и распаковать в `$BACKUP_ROOT/<name>.partial`, проверить, что
    `manifest.json` содержит `"name": "<name>"` и `verified: true`, переименовать в `<name>`, записать
    `offsite.json`; любая ошибка — удалить `.partial` и файл в `$SCRATCH`;
  - `verify-offsite <name>` — то же скачивание и расшифровка во временный каталог `$SCRATCH/<name>.check`, затем
    шаги `cmd_verify` (restore во временный экземпляр + `check_restored` по манифесту), каталог удаляется; лог
    `verify-offsite <name>: ok — …`. Это учебное восстановление O12 *(уточнение плана: отдельная команда вместо
    «fetch + backup-verify», потому что на сервере копия с тем же именем обычно уже лежит — ruling в ledger)*;
  - `env-push` — env-файл из stdin, шифрование теми же получателями, `rclone rcat` в
    `offsite:<bucket>/<APP_ENV>/env/<UTC>.env.age`; размер 0 на stdin → `die`.
- [ ] **Step 1:** команды и строки `case`/usage.
- [ ] **Step 2: Проверка:** `sh -n`.
- [ ] **Step 3: Commit** `feat(backup): list, fetch and verify the offsite copies, push a copy of the env file`.

### Task 4: Команды `stack.mjs`

**Files:** Modify `tools/scripts/stack.mjs` (шапка с командами, `COMMANDS`, `BACKUP_COMMANDS`, `switch`).

**Interfaces:**
- Consumes: команды задач 2–3.
- Produces:
  - `offsite-list` → `compose run --rm --no-deps -T backup pharmacy-backup list-offsite`;
  - `offsite-fetch <copy> --identity <файл>` и `offsite-verify <copy> --identity <файл>` → `compose run --rm
    --no-deps -T backup pharmacy-backup fetch|verify-offsite <copy>`, содержимое файла ключа — в stdin процесса
    (`spawnSync … { input, stdio: ['pipe', 'inherit', 'inherit'] }`), путь ключа не печатается; без `--identity` —
    `fail`;
  - `env-push` → `docker run --rm -i --pull=never` с образом `pharmacy/postgres:<IMAGE_TAG>`, переменные выгрузки
    передаются `-e NAME` без значения (значения — в окружении `spawnSync`, не в командной строке), stdin — env-файл
    среды; команда `pharmacy-backup env-push`;
  - `run` не используется для `fetch`/`verify-offsite` через `exec`: при потере сервера поднят только `postgres`
    (`--no-deps` у `run`).
  - `build`/`up` в prod без `BACKUP_OFFSITE_BUCKET` — предупреждение «копий вне хоста нет (решение 7.1)», не отказ.
- [ ] **Step 1:** изменения. **Step 2: Проверка:** `node --check tools/scripts/stack.mjs`; `npm run stack -- dev
  offsite-list` → отказ «backups exist in test and prod only». **Step 3: Commit**
  `feat(stack): offsite-list, offsite-fetch, offsite-verify and env-push`.

### Task 5: Документы

**Files:**
- Modify: `CLAUDE.md` — раздел «Бэкапы»: последний пункт («копия за пределы хоста… ещё не сделаны») заменить
  описанием выгрузки, Object Lock, команд, учебного восстановления раз в месяц и `env-push`; строки команд в блоке
  `npm run stack -- <test|prod> …`.
- Modify: `docs/guides/deploy-vps.md` — настройка бакета (спецификация §5), переменные в шаге 2, восстановление на
  новом сервере из внешней копии (`cat key.txt | ssh … dc run --rm --no-deps -T backup pharmacy-backup fetch
  <копия>`), ежедневная проверка — строка про выгрузку в `pb status`.
- Modify: спецификация — пометка у O12 об отдельной команде `verify-offsite` (уточнение при реализации).
- [ ] **Step 1:** правки. **Step 2:** `npm run docs:check`. **Step 3: Commit** `docs: the copies off the host —
  CLAUDE.md, the VPS guide, the spec`.

### Task 6: Живая проверка и ревью

Временный стек как у прошлых веток (`pharmacy-offsite`, свои порты, случайный env), override compose: том хоста
`/offsite` в `backup`; `RCLONE_CONFIG_OFFSITE_TYPE=local`, `BACKUP_OFFSITE_BUCKET=/offsite`, получатель — ключ,
сгенерированный `age-keygen` из собранного образа (закрытый — только в scratchpad).

- [ ] `stack backup` → копия проверена, в `/offsite/test/` объект `<копия>.tar.age`; его первые байты —
  `age-encryption.org/v1`, а не заголовок tar; `offsite.json` есть; `backup-status` показывает `offsite yes`.
- [ ] Неверный получатель (`BACKUP_AGE_RECIPIENTS=bad`) → копия проверена, выгрузки нет, `$STATE/offsite` —
  `error …`, лог без секретов; исправление → следующий `push` выгружает.
- [ ] Хранилище недоступно (каталог `/offsite` только для чтения) → то же, копия цела.
- [ ] `offsite-list` → копия видна; `offsite-verify <копия> --identity <ключ>` → `ok`; чужой ключ → ошибка `age`,
  временных каталогов не осталось.
- [ ] Потеря сервера: удалить локальный каталог копии → `offsite-fetch` → каталог с `offsite.json`; повторный
  `offsite-fetch` → отказ «уже есть»; `restore <копия>` (план) проходит.
- [ ] `env-push` → объект `test/env/<время>.env.age`; расшифрованный закрытым ключом совпадает с env-файлом (хеш).
- [ ] Здоровье: при включённой выгрузке и свежей выгрузке — healthy; `APP_ENV=prod` без бакета — unhealthy.
- [ ] Повторный `push` при уже выгруженном объекте того же размера (удалить только `offsite.json`) — объект не
  перезаписывается, `offsite.json` восстановлен.
- [ ] Стек, образы, ключи и env удалить.
- [ ] Ревью ветки свежим агентом; Critical/Important и мелкие — исправить в этой же ветке (правило пользователя),
  проверить вживую снова.
- [ ] Настоящий бакет — когда архитектор его создаст (вне PR): один `backup` + `offsite-verify` (Review Focus 1).
