# Хранилище секретов: файлы секретов на хосте среды и compose secrets

- **Дата:** 2026-10-27
- **Статус:** на утверждение архитектором
- **Основание:** ADR-0021 (принят 2026-10-27); вопрос № 8 stack.md; решение 7.1 и находка S6 ревью безопасности
  2026-10-22. Пользователь попросил писать без вопросов: решения K1–K16 — решения автора.

## 1. Цель и критерии успеха

В test и prod ни один секрет не проходит через окружение контейнеров, аргументы процессов, `docker inspect` и
`docker compose config`. Каждый сервис получает только свои секреты, и только файлами. На машине сборки открытых
секретов prod нет.

Готово, когда:
- стек test поднимается с секретами из файлов;
- вход, касса, миграции, копия и её восстановление работают;
- в выводе `docker inspect` всех контейнеров и `docker compose config` нет ни одного значения секрета;
- `docker top redis` не показывает пароль;
- существующий стенд test переходит на файлы с прежними значениями: тома не пересоздаются, вход прежним паролем
  работает;
- env-файл и секреты восстанавливаются из бакета одной командой.

## 2. Решения автора

| № | Решение |
|---|---|
| K1 | **Каталог и права.** Каталог задаёт переменная `SECRETS_DIR` env-файла, путь относительно `docker/`: `./secrets/test`, `./secrets/prod`; `docker/secrets/` — в `.gitignore`. Каталог — 0700, владелец — пользователь выкладки; файлы — 0444, без перевода строки в конце. Права решает хост: Compose без Swarm игнорирует `uid`, `gid` и `mode` секретов (проверено). Каталог 0700 закрывает файлы от других пользователей хоста, а смонтированный файл в контейнере читает его сервис. Проверено на Linux-семантике Docker: файл 0444 из каталога 0700 чужого владельца читается в контейнере пользователем 70, а через путь каталога — нет. |
| K2 | **Секреты и их получатели** — таблица раздела 3. Активные идентификаторы ключей (`SESSION_JWT_ACTIVE_KID`, `PASSWORD_PEPPER_ACTIVE`), имена, адреса и `RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID` остаются в env-файле. |
| K3 | **Compose.** В базовом `compose.yml` секретов нет: секретные переменные dev переходят в `compose.dev.yml` с теми же значениями из `.env`, и dev работает как раньше. Новый `docker/compose.secrets.yml` для test и prod `stack.mjs` добавляет сам, как `compose.backup.yml`. В нём верхнеуровневые `secrets:` из `${SECRETS_DIR}`, а у каждого сервиса — `secrets:` и переменные `*_FILE`; это единственное место, где видно, кто что получает. Отдельный файл нужен по двум причинам: `!reset` в overlay не отменяет `${…:?}` базового файла, потому что подстановка срабатывает раньше слияния (проверено); и test с prod должны подключать секреты одинаково. |
| K4 | **API и скрипты образа `api`.** Загрузчик `apps/api/scripts/secret-files.mjs` попадает в образ как asset. В `compose.secrets.yml` его подключает `NODE_OPTIONS=--import=/app/scripts/secret-files.mjs`, поэтому он срабатывает раньше любого кода: `main.js`, `migrate.mjs`, скриптов оператора. Правила: `<P>_PASSWORD_FILE` при заданном `<P>_URL` вставляет пароль в URL — в compose URL записан без пароля, например `postgres://pharmacy_app@postgres:5432/pharmacy`; иначе `<V>_FILE` задаёт `<V>`. Если заданы и `<V>`, и `<V>_FILE`, или файл не читается, процесс не стартует, а ошибка называет переменную и путь, но не значение. Перевод строки в конце файла отбрасывается. В dev загрузчика нет: переменные берутся из `.env`. `generate-store-secrets.mjs` (офлайн-точка) не меняется. |
| K5 | **PostgreSQL.** Пароль суперпользователя — через `POSTGRES_PASSWORD_FILE` официального образа. `01-roles.sh` (официальный entrypoint подключает его через `source`) читает `PHARMACY_*_PASSWORD_FILE`, а в dev — переменную, в неэкспортируемые переменные. В psql пароли идут через его окружение и `\getenv`, а не аргументами — это часть S6. Новый скрипт образа `pharmacy-psql` запускает psql суперпользователем по локальному сокету: пароль — из `POSTGRES_PASSWORD_FILE` (в dev — `PGPASSWORD`), `PHARMACY_BACKUP_PASSWORD` для `04-backup-role.sql` — из файла, остальные аргументы передаются psql. Им пользуются `stack up` (роль копий), `pharmacy-backup restore`, команды руководства и CLAUDE.md. При initdb `04-backup-role.sql` без переменной ничего не делает, как сейчас в dev. Роль копий создаёт первый `stack up` или шаг 4 руководства — так же, как сегодня на существующем кластере. |
| K6 | **Redis.** В test и prod — `--aclfile /run/secrets/redis_users_acl` вместо `--requirepass`: контейнер Redis знает только SHA-256 пароля, и пароля нет в аргументах процесса. Проверка здоровья — `redis-cli ping` без пароля, годятся ответы `PONG` и `NOAUTH`: оба означают, что сервер отвечает. Проверка одна для всех сред. dev — `--requirepass` из `.env`, как сейчас, в `compose.dev.yml`. |
| K7 | **Сервис копий.** `pharmacy-backup` при старте читает `PGPASSWORD_FILE` и `RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY_FILE`; пустой файл ключа S3 означает, что ключа нет. `restore` берёт пароль суперпользователя тем же способом, что `pharmacy-psql`. |
| K8 | **Генератор — один:** скрипт `pharmacy-secrets` в образе `pharmacy/postgres` (POSIX sh, busybox: `/dev/urandom`, `base64`, `sha256sum`). `init` создаёт только отсутствующие файлы и существующие не перезаписывает: пароли — 24 случайных байта в base64url, кольца — `k1:` и `1:` плюс 32 байта, `offsite_secret_access_key` — пустой. `redis_users_acl` при каждом запуске пересчитывается из `redis_password`. `check` проверяет, что все файлы на месте, пароли не короче 16 символов и нет `change-me` и `generate-key`; значения он не печатает. Запуск — сервис-инструмент `secrets` в `compose.secrets.yml` (профиль `tools`, том `${SECRETS_DIR}:/s`). Команда `docker compose … --profile tools run --rm secrets init` одинаково работает на Windows (относительный путь) и на VPS, где Node нет. |
| K9 | **`stack.mjs`.** `composeArgs` добавляет `compose.secrets.yml` для test и prod. `init` создаёт env-файл из примера без секретов, с `SECRETS_DIR`. Для test секреты из прежнего env-файла переносятся в файлы с теми же значениями, а их строки в env-файле закомментируются с пометкой `moved to <SECRETS_DIR>/<file> (ADR-0021)`; значения не печатаются. `up` и `restore` в test и prod: при отсутствии файлов — `secrets init` образом этого коммита, затем `secrets check`; проверка S2 строк env-файла заменяется ею. `build` секреты не проверяет: сборке они не нужны, а `compose config` без файлов проходит (проверено). Но `build` и `up` в prod отказывают, если в `prod.env` остались секретные переменные, и называют их: секреты prod живут только на VPS. |
| K10 | **`env-push`.** Архив — tar из `env/<env>.env` и `secrets/<env>/`. `pharmacy-backup env-push` шифрует stdin потоком (`age … -o`), не держа открытый текст ни в переменной, ни на диске: tar с NUL-байтами в переменную shell не помещается. Объект — `<APP_ENV>/env/<время UTC>.tar.age` вместо `.env.age`; объектов старого формата нет, prod не выкладывался. Запуск — на хосте среды. Для test — `stack test env-push`: tar делает встроенный `tar.exe` Windows или `tar` хоста, затем `compose run --rm --no-deps -T backup pharmacy-backup env-push`. Для prod — `tar -C /opt/pharmacy/docker -cf - env/prod.env secrets/prod \| dc run --rm --no-deps -T backup pharmacy-backup env-push`. Восстановление — `age -d` образом `pharmacy/postgres` и `tar -x` в `/opt/pharmacy/docker`, затем права K1. |
| K11 | **Перенос стенда test** (`pharmacy-test` и любые env-файлы test): `stack test init` (перенос из K9), затем `stack test build` и `stack test up`. Тома не пересоздаются, значения прежние. Проверка после переноса: вход прежним паролем (pepper тот же), `backup-status`, `docker inspect` без значений. |
| K12 | **Доступ** (ADR-0021, п. 6) — в руководстве по выкладке. root и группа `docker` на VPS — только у архитектора и второго хранителя, вход по SSH-ключам без пароля. Файлы `secrets/` не открываются ни при диагностике, ни AI-ассистентами; `docker inspect` и `compose config` после перехода безопасны. |
| K13 | **Ротация** — раздел руководства «Ротация секретов», процедуры раздела 5. После каждой ротации — `env-push`. После взлома меняется всё сразу. |
| K14 | **Документы:** CLAUDE.md («Environments», «Бэкапы», «Containers», «Local development secrets», команды проверки суперпользователя); `docs/guides/deploy-vps.md` (env-файл без секретов, шаг «Секреты на VPS», `pharmacy-psql`, `env-push`, новый сервер, «После взлома сервера», ротация, доступ); stack.md — вопрос № 8 закрыт ссылкой на ADR-0021; ADR-0008 — строка «Pepper» ссылается на ADR-0021; примеры env-файлов test и prod; `docs/qa` — запуск стенда. |
| K15 | **Проверка.** Тесты отложены до MVP (решение 2026-10-05), поэтому проверка живая, на временном стеке Docker Desktop: initdb с файлами, роли, `migrate`, `api` (вход сотрудника и оператора), Redis с ACL, `backup` (копия, выгрузка в remote типа `local`, `restore --check`), `env-push` и восстановление архива. Отдельно проверяется перенос: env-файл со старыми секретами → `init` → в файлах те же значения → вход прежним паролем. `docker inspect` всех контейнеров, `docker compose config` и `docker top` сверяются со значениями файлов: ни одного совпадения. Linux-семантика прав проверена пробой при написании спецификации (K1). Первый прогон на VPS — при первой выкладке. |
| K16 | **Вне объёма:** офлайн-точка (`generate-store-secrets.mjs`, env-файл ПК точки); шифрование файлов на диске хоста; Vault и KMS; CI. |

## 3. Секреты и сервисы

| Файл | Значение | Сервисы |
|---|---|---|
| `postgres_superuser_password` | пароль суперпользователя | `postgres` |
| `pharmacy_owner_password` | роль `pharmacy_owner` | `postgres`, `migrate` |
| `pharmacy_app_password` | роль `pharmacy_app` | `postgres`, `api` |
| `pharmacy_platform_password` | роль `pharmacy_platform` | `postgres`, `api` |
| `pharmacy_backup_password` | роль `pharmacy_backup` | `postgres`, `backup` |
| `redis_password` | пароль Redis | `api` |
| `redis_users_acl` | `user default on #<sha256 пароля> ~* &* +@all` — только хеш | `redis` |
| `session_jwt_keys` | кольцо ключей сессий, `k1:<base64url>` | `api` |
| `password_peppers` | кольцо pepper, `1:<base64url>` | `api` |
| `offsite_secret_access_key` | ключ S3 бакета копий; пустой — выгрузки нет | `backup` |

`proxy` секретов не получает. Сервис-инструмент `secrets` монтирует весь каталог, но запускается только вручную
(профиль `tools`).

## 4. Выкладка prod

1. На машине архитектора: `npm run stack -- prod init` создаёт `prod.env` без секретов; его заполняют и копируют на VPS,
   как сейчас. Сборка образов и их перенос — как сейчас.
2. На VPS, один раз:
   - `install -d -m 700 /opt/pharmacy/docker/secrets/prod`;
   - `dc --profile tools run --rm secrets init`;
   - ключ S3 из панели Contabo — в `offsite_secret_access_key`, без истории shell (`read -rs`), права 0444;
   - `dc --profile tools run --rm secrets check`.
3. Запуск (шаг 4 руководства): роль копий — через `dc exec -T postgres pharmacy-psql -f …/04-backup-role.sql`.
4. `env-push` (K10).

## 5. Ротация (руководство)

- **Пароль роли БД:** новый файл, `ALTER ROLE … PASSWORD` через `pharmacy-psql`, затем
  `dc up -d --force-recreate` сервисов этой роли.
- **Суперпользователь:** `ALTER ROLE`, новый файл, пересоздать `postgres`.
- **Redis:** новый `redis_password`, `secrets init` (пересчёт ACL), пересоздать `redis` и `api` — все сессии
  сбрасываются.
- **Ключи сессий:** добавить `k2:<…>` в кольцо, `SESSION_JWT_ACTIVE_KID=k2`, пересоздать `api`; старый ключ убрать через
  12 ч — абсолютный срок сессии.
- **Pepper:** добавить `2:<…>`, `PASSWORD_PEPPER_ACTIVE=2`. Старая версия остаётся в кольце, пока по ней есть хеши:
  ADR-0008 переводит хеши на новую версию постепенно, при входе.
- **Ключ S3:** новый ключ в Contabo, файл, пересоздать `backup`, проверить `push`, отозвать старый ключ.

## 6. Документы

См. K14. ADR-0021 не меняется.
