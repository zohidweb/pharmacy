# Выкладка prod на VPS (пилот)

Ручная выкладка по ADR-0020 до отдельного ADR о CD. Хост — Contabo Cloud VPS 6 (EU), домен `nurmed.online`,
вход — Caddy (ADR-0012). На хосте нет исходного кода, Node.js и npm: только Docker, compose-файлы, env-файл и каталог
секретов (ADR-0021: каждый секрет — свой файл, в контейнеры — через `secrets:` Compose; env-файл секретов не хранит).

## 1. Сервер (один раз)

1. Заказ: Cloud VPS 6, диск **100 ГБ NVMe**, регион EU (Германия), образ **Ubuntu 24.04**, при заказе — свой SSH-ключ.
   Перед вводом в эксплуатацию — письменное согласие юриста на хранение данных за пределами РТ (ADR-0020).
2. DNS зоны `nurmed.online`: A-записи `@`, `app`, `admin` → IPv4 сервера. AAAA не задавать, пока IPv6 не проверен:
   Let's Encrypt проверяет по ней, если она есть.
3. Под root, один раз:

   ```bash
   adduser --disabled-password --gecos "" deploy
   install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
   cp /root/.ssh/authorized_keys /home/deploy/.ssh/ && chown deploy:deploy /home/deploy/.ssh/authorized_keys
   printf 'PasswordAuthentication no\nPermitRootLogin no\nKbdInteractiveAuthentication no\n' > /etc/ssh/sshd_config.d/10-hardening.conf
   systemctl reload ssh
   apt-get update && apt-get -y upgrade && apt-get -y install unattended-upgrades ufw
   dpkg-reconfigure -f noninteractive unattended-upgrades
   ufw default deny incoming && ufw default allow outgoing
   ufw allow from <IP команды> to any port 22 proto tcp
   ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp
   ufw enable
   ```

   Тот же набор портов — в firewall панели Contabo. Перед `ufw enable` проверьте вход `ssh deploy@<IP>` во втором окне.
   Docker публикует порты в обход `ufw`: наружу открыты только порты proxy, остальные сервисы в `compose.prod.yml` не
   публикуются — не добавляйте им `ports`.
4. Docker Engine и Compose-плагин — из официального репозитория Docker
   (docs.docker.com/engine/install/ubuntu, пакеты `docker-ce`, `docker-compose-plugin`). `usermod -aG docker deploy`:
   группа `docker` равна root на этом хосте — только для `deploy`.
5. Каталог `/opt/pharmacy` (владелец `deploy`) с подкаталогами `docker/`, `docker/env/` и `docker/secrets/prod`
   (`install -d -m 700 /opt/pharmacy/docker/env /opt/pharmacy/docker/secrets/prod` от `deploy`): каталог секретов —
   `SECRETS_DIR` env-файла, его создаёт `deploy`, а не Docker (иначе владельцем стал бы root).
6. Каталог копий БД (ADR-0019) — `BACKUP_DIR` env-файла, владелец uid 70 (postgres в образе):
   `install -d -o 70 -g 70 -m 700 /srv/pharmacy-backups/prod`. На VPS один диск: копии на нём не переживут потерю
   сервера, поэтому каждая копия уходит во внешнее хранилище (раздел 2.1); пока оно не настроено, реальные данные не
   вносить (решение 7.1, `backup` в prod без него unhealthy).
7. Команды compose пользователя `deploy` — одни на все шаги ниже (`~/.bashrc`). Тег образов — `IMAGE_TAG` сессии, иначе
   тег работающей выкладки из `/opt/pharmacy/image-tag` (шаг 4); без тега `dc` не запускается: compose взял бы тег
   `local`, которого на хосте нет (образы не скачиваются — `pull_policy: never`).

   ```bash
   dc() ( export IMAGE_TAG="${IMAGE_TAG:-$(cat /opt/pharmacy/image-tag 2>/dev/null)}"; : "${IMAGE_TAG:?export IMAGE_TAG=<sha>}"
     cd /opt/pharmacy && docker compose --project-name pharmacy-prod --env-file docker/env/prod.env \
       -f docker/compose.yml -f docker/compose.prod.yml -f docker/compose.backup.yml -f docker/compose.secrets.yml "$@" )
   pb() { dc exec -T -u postgres -e TZ=Asia/Dushanbe postgres pharmacy-backup "$@"; }
   S=/opt/pharmacy/docker/secrets/prod
   ```

## 2. Env-файл prod (один раз, на своей машине)

```bash
npm run stack -- prod init
```

В `docker/env/prod.env` заполнить `ACME_EMAIL` и `OPERATOR_ALLOW` — публичные IP офисов операторов или VPN (CIDR через
пробел, `203.0.113.10/32`): админка и `/api/v1/operator/*` отвечают только им, остальным 403 (ревью безопасности
2026-10-22, A1; поправка ADR-0012 2026-10-23). Адреса `nurmed.online`, `BACKUP_DIR` и `SECRETS_DIR` уже стоят. Секретов
в нём нет и не должно быть: их создаёт сервер (раздел 4), а `npm run prod:build` и `up` отказывают, пока в `prod.env`
есть пароль, ключ или pepper (тогда — удалить названные строки). Перенести на хост и закрыть права:

```bash
scp docker/env/prod.env deploy@<IP>:/opt/pharmacy/docker/env/prod.env
ssh deploy@<IP> chmod 600 /opt/pharmacy/docker/env/prod.env
```

Локальная копия — не в git и не в чаты. Pepper паролей, ключи JWT и пароли лежат только на сервере, в каталоге
секретов; их копия — зашифрованный `age` архив `env-push` в бакете (раздел 2.1, шаг 6). Потеря pepper = все пароли и
PIN недействительны (ADR-0008).

## 2.1. Хранилище копий вне хоста (один раз, ADR-0020)

Спецификация `docs/superpowers/specs/2026-10-23-offsite-backups-design.md`, раздел 5.

1. Ключи `age` у двух хранителей — каждый на своей машине: `age-keygen -o key.txt` (официальный бинарник age или
   `docker run --rm --pull=never pharmacy/postgres:<sha> age-keygen`). Закрытый ключ — в менеджер паролей хранителя,
   не в git, не в чаты и не на сервер; открытые ключи `age1…` обоих — в `BACKUP_AGE_RECIPIENTS` через пробел.
2. В панели Contabo — Object Storage в регионе **US Central** или **Singapore** (не EU, где VPS).
3. Бакет — с Object Lock (создаётся только так, включить потом нельзя), режим **COMPLIANCE**, срок по умолчанию
   **30 дней**. Object Lock включает версии: запись того же имени или удаление кладут поверх новую версию или метку
   удаления, а прежняя версия остаётся до конца срока. Поэтому lifecycle — из трёх частей: текущая версия истекает через
   **31 день**, прежние версии удаляются через день после этого (под блокировкой — не раньше её срока), одинокие метки
   удаления и брошенные multipart-загрузки убираются. Без удаления прежних версий копии не исчезают никогда.
   Например, `aws` CLI (`--endpoint-url https://usc1.contabostorage.com` или `sin1` у каждой команды):

   ```bash
   aws s3api create-bucket --bucket <имя> --object-lock-enabled-for-bucket
   aws s3api put-object-lock-configuration --bucket <имя> --object-lock-configuration '{"ObjectLockEnabled":"Enabled","Rule":{"DefaultRetention":{"Mode":"COMPLIANCE","Days":30}}}'
   aws s3api put-bucket-lifecycle-configuration --bucket <имя> --lifecycle-configuration '{"Rules":[{"ID":"copies","Status":"Enabled","Filter":{"Prefix":""},"Expiration":{"Days":31},"NoncurrentVersionExpiration":{"NoncurrentDays":1},"AbortIncompleteMultipartUpload":{"DaysAfterInitiation":1}},{"ID":"delete-markers","Status":"Enabled","Filter":{"Prefix":""},"Expiration":{"ExpiredObjectDeleteMarker":true}}]}'
   aws s3api get-bucket-lifecycle-configuration --bucket <имя>
   ```

   Последняя команда должна вернуть оба правила. Если Contabo отклоняет часть — не продолжать без решения архитектора.
4. Ключ сервера. По возможности — отдельный пользователь Contabo с политикой только на этот бакет: `s3:PutObject`,
   `s3:GetObject`, `s3:GetObjectVersion`, `s3:ListBucket`, `s3:ListBucketVersions` и ничего больше — ни `s3:Delete*`,
   ни прав на сроки блокировки и legal hold, ни `s3:PutBucket*`. Чтение нужно: rclone сверяет выгруженный объект, а
   `fetch` на новом сервере работает тем же ключом; в бакете только шифротекст. Если ограничить ключ нельзя — ключи S3
   аккаунта (поправка ADR-0020 2026-10-23: от удаления защищает Object Lock). Бакет rclone не создаёт: ошибка в имени —
   ошибка выгрузки в `pb status`, а не новый бакет без Object Lock.
5. В `docker/env/prod.env`: `BACKUP_OFFSITE_BUCKET`, `BACKUP_AGE_RECIPIENTS`, `RCLONE_CONFIG_OFFSITE_ENDPOINT`
   (`https://usc1.contabostorage.com` или `https://sin1.contabostorage.com`), `RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID`.
   Секретный ключ S3 — не сюда, а в файл `offsite_secret_access_key` на сервере (раздел 4, первый запуск). Ключи S3 —
   ещё и в менеджер паролей хранителей: при потере сервера архив env-файла и секретов достают из бакета ими же.
6. После первого запуска (раздел 4) — копия env-файла и секретов в бакет, на сервере:
   `tar -C /opt/pharmacy/docker -cf - env/prod.env secrets/prod | dc run --rm --no-deps -T backup pharmacy-backup env-push`;
   и после каждого изменения env-файла или секрета. Архив шифруется потоком, открытый текст не ложится на диск; объект —
   `prod/env/<время UTC>.tar.age`.

## 3. Сборка и перенос образов (каждая выкладка)

На своей машине, из чистого дерева на коммите `main`:

```bash
npm run prod:build
```

Тег образов — короткий sha коммита (`git rev-parse --short HEAD`). Перенос четырёх образов:

```bash
docker save pharmacy/api:<sha> pharmacy/postgres:<sha> pharmacy/redis:<sha> pharmacy/proxy:<sha> | gzip | ssh deploy@<IP> "gunzip | docker load"
```

Compose-файлы — те же, что в репозитории на этом коммите:

```bash
scp docker/compose.yml docker/compose.prod.yml docker/compose.backup.yml docker/compose.secrets.yml deploy@<IP>:/opt/pharmacy/docker/
```

## 4. Запуск

Если в выкладке есть миграции — сначала снимок диска в панели Contabo (откат миграций только так, ADR-0006: только Up).

Первый запуск — сначала секреты (ADR-0021; спецификация `2026-10-27-secret-store-design.md`, раздел 4). Скрипт
`pharmacy-secrets` из образа `pharmacy/postgres` создаёт недостающие файлы случайными значениями (существующие не
перезаписывает), отдаёт их владельцу каталога (`deploy`) с правами 0444 и пересчитывает `redis_users_acl` — у Redis
только SHA-256 пароля. Ключ S3 из панели Contabo вводится без эха и без истории shell:

```bash
ssh deploy@<IP>
export IMAGE_TAG=<sha>
dc --profile tools run --rm secrets init
( umask 077; read -rs k && printf '%s' "$k" > "$S/.k" && chmod 444 "$S/.k" && mv -f "$S/.k" "$S/offsite_secret_access_key" )
dc --profile tools run --rm secrets check
```

`check` называет файлы, которых нет, с переводом строки, с заглушкой или с паролем короче 16 символов; значения он
не печатает. Каждая выкладка:

```bash
ssh deploy@<IP>
export IMAGE_TAG=<sha>
dc --profile tools run --rm secrets check
dc up -d --no-build --wait postgres
dc exec -T postgres pharmacy-psql -q -f /docker-entrypoint-initdb.d/04-backup-role.sql
dc up -d --no-build --wait && echo "$IMAGE_TAG" > /opt/pharmacy/image-tag
dc ps
```

Третий шаг `npm run stack -- prod up` делает сам: создаёт или обновляет роль `pharmacy_backup` по паролю из её файла
(ADR-0019). `pharmacy-psql` — psql суперпользователем по локальному сокету с паролем из файла: пароль не попадает ни в
аргументы, ни в окружение контейнера. `image-tag` — тег работающей выкладки для `dc` в следующих сессиях. После первого
запуска — `env-push` (раздел 2.1, шаг 6).

Первый старт proxy выпускает сертификаты Let's Encrypt: нужны DNS из шага 1.2 и открытый 80-й порт. Ошибка выпуска —
в `dc logs proxy`. Том `pharmacy-prod_proxy-data` хранит ключ ACME-аккаунта и сертификаты — не удалять.

## 5. Проверка

```bash
curl -fsS https://app.nurmed.online/api/v1/health
curl -sI https://app.nurmed.online/ | grep -i strict-transport
curl -s -o /dev/null -w '%{http_code}\n' https://app.nurmed.online/api/v1/operator/session   # 404
curl -s -o /dev/null -w '%{http_code}\n' https://nurmed.online/                             # 301 → app.
curl -s -o /dev/null -w '%{http_code}\n' https://admin.nurmed.online/       # 403 не с адресов OPERATOR_ALLOW, 200 — с них
```

Затем в браузере: вход оператора на `admin.nurmed.online` (с адреса из `OPERATOR_ALLOW`), вход сотрудника и касса на
`app.nurmed.online`. Первая копия БД — сразу, не ночью: `dc exec -T backup pharmacy-backup run`; в `pb status` у неё
`offsite yes`, а `dc exec -T backup pharmacy-backup list-offsite` показывает её в бакете.

Один раз — проверка бакета на этой копии (`aws` CLI, как в разделе 2.1):

- `aws s3api get-object-retention --bucket <имя> --key prod/<копия>.tar.age` — `COMPLIANCE`, срок через 30 дней;
- `aws s3api list-object-versions --bucket <имя> --prefix prod/<копия>` — одна версия; удаление этой версии
  `aws s3api delete-object --bucket <имя> --key prod/<копия>.tar.age --version-id <VersionId>` — отказ (AccessDenied);
- `list-offsite --at <время UTC до копии>` — без копий, `list-offsite` — с ней (чтение по версиям);
- учебное восстановление этой копии (раздел «Ежедневно…», `verify-offsite`).

Если любая проверка не проходит — реальных данных на сервер не заводить (решение 7.1).

## 6. Первый оператор и сеть

Как в CLAUDE.md, раздел «Containers»: `create-operator.mjs`, затем `create-activation-code.mjs` — командой
`dc run --rm --no-deps api node scripts/<скрипт> …` с тем же `IMAGE_TAG`.

## 7. Откат

Прежний тег — вместе с compose-файлами его коммита: новые файлы могут требовать сервис или образ, которого у прежнего
тега нет. На своей машине:

```bash
for f in compose.yml compose.prod.yml compose.backup.yml compose.secrets.yml; do git show <прежний sha>:docker/$f | ssh deploy@<IP> "cat > /opt/pharmacy/docker/$f"; done
```

Затем на хосте `export IMAGE_TAG=<прежний sha>` и `dc up -d --no-build --wait && echo "$IMAGE_TAG" > /opt/pharmacy/image-tag`. Если новая версия применила миграции —
откат кода без отката БД возможен не всегда: восстановить снимок диска из шага 4.

## Ежедневно, пока нет мониторинга

`dc ps` — все сервисы `healthy` (`backup` unhealthy — проверенной копии нет 26 ч, свежая копия не ушла из хоста 26 ч
или внешнее хранилище не настроено); место на диске `df -h`; копии, колонка `offsite`, строка «off the host» и причина
блокировки — `pb status`.

Раз в месяц хранитель ключа — учебное восстановление последней копии из бакета (временный экземпляр в контейнере
`backup`, рабочая база не трогается; в спокойное время — грузит CPU):

```bash
ssh deploy@<IP> 'cd /opt/pharmacy && IMAGE_TAG=$(cat image-tag) docker compose --project-name pharmacy-prod --env-file docker/env/prod.env -f docker/compose.yml -f docker/compose.prod.yml -f docker/compose.backup.yml -f docker/compose.secrets.yml run --rm --no-deps -T backup pharmacy-backup verify-offsite <копия>' < key.txt
```

## Восстановление из копии

Node на хосте нет — те же шаги, что `npm run stack -- prod restore <копия> --replace-database` (CLAUDE.md, «Бэкапы»):

```bash
pb restore <копия> --check
dc stop api backup
pb restore <копия>      # при ошибке рабочая база не тронута: dc up -d --no-build --wait api backup
dc restart redis        # все входят заново
```

Затем шаг 4 целиком: роль копий и `migrate`, который догоняет миграции новее копии. Прежняя база остаётся как
`pharmacy_before_<копия>` (без подключений) и удаляется вручную:
`dc exec -T postgres pharmacy-psql -d postgres -c "drop database pharmacy_before_<копия>"`. Пароли и PIN
восстановленной базы работают только с pepper её каталога секретов (`password_peppers`, ADR-0008).

## Новый сервер вместо потерянного

1. Раздел 1 — новый VPS; DNS — на его IP.
2. Раздел 3 — образы и compose-файлы того коммита, что работал (или новее).
3. Env-файл и секреты — из бакета: последний объект `prod/env/<время>.tar.age` (панель Contabo или `aws s3 cp` ключами
   S3 из менеджера паролей) скопировать на сервер в `/opt/pharmacy/docker/` (это шифротекст) и расшифровать там образом
   `pharmacy/postgres` от пользователя `deploy`; закрытый ключ хранителя идёт по ssh в stdin и на диск сервера не
   попадает:

   ```bash
   scp <время>.tar.age deploy@<IP>:/opt/pharmacy/docker/
   ssh deploy@<IP> 'cd /opt/pharmacy/docker && docker run --rm -i --pull=never --network none --user "$(id -u):$(id -g)" -v "$PWD:/w" pharmacy/postgres:<sha> sh -c "age -d -i /dev/stdin /w/<время>.tar.age | tar -x -C /w" && rm <время>.tar.age && chmod 600 env/prod.env && chmod 700 secrets/prod && chmod 444 secrets/prod/*' < key.txt
   ```

   Затем `dc --profile tools run --rm secrets check`.
4. Только PostgreSQL: `export IMAGE_TAG=<sha>; dc up -d --no-build --wait postgres`. Не полный `up`: на новом хосте
   `BACKUP_DIR` пуст, защите пустой базы (B15) не с чем сравнить, и `backup` сразу скопировал бы пустую базу и выгрузил
   её как самую свежую копию вне хоста.
5. Имя последней копии и сама копия — из бакета; закрытый ключ идёт по ssh в stdin и на диск сервера не попадает
   (после взлома — с `--at`, раздел ниже):

   ```bash
   ssh deploy@<IP> 'cd /opt/pharmacy && IMAGE_TAG=<sha> docker compose --project-name pharmacy-prod --env-file docker/env/prod.env -f docker/compose.yml -f docker/compose.prod.yml -f docker/compose.backup.yml -f docker/compose.secrets.yml run --rm --no-deps -T backup pharmacy-backup list-offsite'
   ssh deploy@<IP> 'cd /opt/pharmacy && IMAGE_TAG=<sha> docker compose --project-name pharmacy-prod --env-file docker/env/prod.env -f docker/compose.yml -f docker/compose.prod.yml -f docker/compose.backup.yml -f docker/compose.secrets.yml run --rm --no-deps -T backup pharmacy-backup fetch <копия>' < key.txt
   ```

6. Дальше — раздел «Восстановление из копии» выше и шаг 4 целиком.

## После взлома сервера

Захвативший сервер знает ключ бакета и открытые ключи `age`. Удалить или изменить выгруженные версии он не может
(Object Lock), но может положить поверх новую версию — подделанную копию или архив env-файла и секретов — или метку
удаления. Текущим объектам бакета после взлома не верить; `list-offsite` показывает прежние версии (`…-v<время>…`).

1. Время взлома (UTC) — раньше первых его следов. Дальше бакет читается «как был» на это время: по времени записи
   версий хранилищем, а не по именам объектов.
2. Env-файл и секреты: `aws s3api list-object-versions --bucket <имя> --prefix prod/env/` — последняя версия с
   `LastModified` раньше взлома, затем
   `aws s3api get-object --bucket <имя> --key prod/env/<время>.tar.age --version-id <VersionId> <время>.tar.age` и
   расшифровка, как в шаге 3 раздела выше.
3. Копия: команды шага 5 раздела выше с `--at <время UTC>` в конце: `list-offsite --at 2026-10-20T21:00:00Z`, затем
   `fetch <копия> --at 2026-10-20T21:00:00Z`.
4. Ключи S3 и все секреты считать раскрытыми: новые ключи S3 (старые отозвать), ключи JWT и пароли ролей и Redis —
   раздел «Ротация секретов», всё сразу. Новый pepper без старого в кольце обесценивает все пароли и PIN — решение
   архитектора.

## Ротация секретов

ADR-0021, спецификация `2026-10-27-secret-store-design.md`, раздел 5. На сервере, от `deploy`, с `dc` и `S` из шага 1.7.
Compose монтирует файл секрета в контейнер при его создании, поэтому после замены файла контейнеры его сервисов
пересоздаются (`--force-recreate`). Файл меняется через временный рядом и `mv`: старый остаётся целым, пока новый не
готов. После каждой ротации — `env-push` (раздел 2.1, шаг 6); после взлома меняется всё сразу.

```bash
rand() { head -c "${1:-24}" /dev/urandom | base64 | tr '+/' '-_' | tr -d '=\n'; }
# rotate_role <роль> <файл> [сервисы…] — новый пароль роли БД: роль берёт его (через окружение psql, не аргументы),
# файл заменяется, postgres и сервисы роли пересоздаются (postgres — чтобы 04-backup-role.sql и pharmacy-psql читали
# новые файлы; это несколько секунд недоступности).
rotate_role() (
  set -e; umask 077; role=$1 file=$2; shift 2
  rand > "$S/.$file"
  NEW_PW=$(cat "$S/.$file"); export NEW_PW
  printf '%s\n' '\getenv pw NEW_PW' "alter role \"$role\" password :'pw';" | dc exec -T -e NEW_PW postgres pharmacy-psql -q -f -
  chmod 444 "$S/.$file" && mv -f "$S/.$file" "$S/$file"
  dc up -d --no-build --force-recreate --wait postgres "$@"
)
```

- **Пароль роли БД:** `rotate_role pharmacy_app pharmacy_app_password api`,
  `rotate_role pharmacy_platform pharmacy_platform_password api`, `rotate_role pharmacy_owner pharmacy_owner_password`
  (`migrate` возьмёт его при следующем `up`), `rotate_role pharmacy_backup pharmacy_backup_password backup`.
- **Суперпользователь:** `rotate_role postgres postgres_superuser_password` (имя — `POSTGRES_SUPERUSER` env-файла).
- **Redis:** `( umask 077; rand > "$S/.r" && chmod 444 "$S/.r" && mv -f "$S/.r" "$S/redis_password" )`, затем
  `dc --profile tools run --rm secrets init` (пересчёт `redis_users_acl`) и
  `dc up -d --no-build --force-recreate --wait redis api` — все сессии сбрасываются, все входят заново.
- **Ключи сессий:** добавить в кольцо `k2` —
  `( umask 077; printf '%s,k2:%s' "$(cat "$S/session_jwt_keys")" "$(rand 32)" > "$S/.j" && chmod 444 "$S/.j" && mv -f "$S/.j" "$S/session_jwt_keys" )`,
  в `prod.env` — `SESSION_JWT_ACTIVE_KID=k2`, затем `dc up -d --no-build --force-recreate --wait api`. Через 12 ч
  (абсолютный срок сессии) старый ключ убрать из кольца тем же способом (оставить только `k2:…`) и снова пересоздать
  `api`.
- **Pepper:** добавить `2:<…>` в `password_peppers` так же, как ключ сессий (`rand 32`), `PASSWORD_PEPPER_ACTIVE=2`,
  пересоздать `api`. Старая версия остаётся в кольце, пока по ней есть хеши: ADR-0008 переводит хеш на новую версию при
  входе. Убрать её раньше — значит обесценить пароли и PIN тех, кто ещё не входил.
- **Ключ S3:** новый ключ в панели Contabo (те же права, раздел 2.1, шаг 4); записать его как при первом запуске
  (раздел 4, `read -rs`), новый `RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID` — в `prod.env`; `dc up -d --no-build
  --force-recreate --wait backup`, проверить выгрузку (`dc exec -T backup pharmacy-backup push`, `pb status`), затем
  отозвать старый ключ.

## Доступ

ADR-0021, п. 6.

- root и группа `docker` на VPS — только у архитектора и второго хранителя ключа `age`; вход только по SSH-ключам
  (раздел 1). Группа `docker` равна root: она читает и каталог секретов, и тома.
- Файлы `secrets/` не открываются (`cat`, `less`, редактор) ни при диагностике, ни AI-ассистентами, не копируются в
  чаты и тикеты; меняются только по разделу «Ротация секретов». `docker inspect`, `dc config`, `dc ps` и `dc logs`
  секретов не показывают — их можно запускать при диагностике.
- Открытые значения секретов prod есть только в каталоге секретов на сервере и в зашифрованном архиве `env-push`; на
  машине архитектора — только `prod.env` без секретов.
