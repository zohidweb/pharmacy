# Выкладка prod на VPS (пилот)

Ручная выкладка по ADR-0020 до отдельного ADR о CD. Хост — Contabo Cloud VPS 6 (EU), домен `nurmed.online`,
вход — Caddy (ADR-0012). На хосте нет исходного кода, Node.js и npm: только Docker, compose-файлы и env-файл.

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
5. Каталог `/opt/pharmacy` (владелец `deploy`) с подкаталогами `docker/` и `docker/env/` (`chmod 700`).
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
       -f docker/compose.yml -f docker/compose.prod.yml -f docker/compose.backup.yml "$@" )
   pb() { dc exec -T -u postgres -e TZ=Asia/Dushanbe postgres pharmacy-backup "$@"; }
   ```

## 2. Env-файл prod (один раз, на своей машине)

```bash
npm run stack -- prod init
```

В `docker/env/prod.env` заполнить `ACME_EMAIL` и `OPERATOR_ALLOW` — публичные IP офисов операторов или VPN (CIDR через
пробел, `203.0.113.10/32`): админка и `/api/v1/operator/*` отвечают только им, остальным 403 (ревью безопасности
2026-10-22, A1; поправка ADR-0012 2026-10-23). Адреса `nurmed.online` и `BACKUP_DIR` уже стоят. Перенести на хост и
закрыть права:

```bash
scp docker/env/prod.env deploy@<IP>:/opt/pharmacy/docker/env/prod.env
ssh deploy@<IP> chmod 600 /opt/pharmacy/docker/env/prod.env
```

Локальную копию — не в git и не в чаты. В нём pepper паролей и ключи JWT (ADR-0008): его копия хранится отдельно от
копий БД, зашифрованной `age` (ADR-0020). Потеря pepper = все пароли и PIN недействительны.

## 2.1. Хранилище копий вне хоста (один раз, ADR-0020)

Спецификация `docs/superpowers/specs/2026-10-23-offsite-backups-design.md`, раздел 5.

1. Ключи `age` у двух хранителей — каждый на своей машине: `age-keygen -o key.txt` (официальный бинарник age или
   `docker run --rm --pull=never pharmacy/postgres:<sha> age-keygen`). Закрытый ключ — в менеджер паролей хранителя,
   не в git, не в чаты и не на сервер; открытые ключи `age1…` обоих — в `BACKUP_AGE_RECIPIENTS` через пробел.
2. В панели Contabo — Object Storage в регионе **US Central** или **Singapore** (не EU, где VPS).
3. Бакет — с Object Lock (создаётся только так, включить потом нельзя), режим **COMPLIANCE**, срок по умолчанию
   **30 дней**; правило lifecycle — истечение объектов через **31 день**. Например, `aws` CLI c endpoint региона:
   `s3api create-bucket --bucket <имя> --object-lock-enabled-for-bucket`, затем
   `s3api put-object-lock-configuration` (COMPLIANCE, Days 30) и `s3api put-bucket-lifecycle-configuration`
   (Expiration Days 31).
4. По возможности — отдельный пользователь Contabo с политикой только на этот бакет; иначе ключи S3 аккаунта
   (поправка ADR-0020 2026-10-23: от удаления защищает Object Lock).
5. В `docker/env/prod.env`: `BACKUP_OFFSITE_BUCKET`, `BACKUP_AGE_RECIPIENTS`, `RCLONE_CONFIG_OFFSITE_ENDPOINT`
   (`https://usc1.contabostorage.com` или `https://sin1.contabostorage.com`), `RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID`,
   `RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY`. Ключи S3 — ещё и в менеджер паролей хранителей: при потере сервера
   env-файл достают из бакета ими же.
6. После сборки образов (раздел 3) — копия env-файла в бакет: `npm run stack -- prod env-push`; и после каждого
   изменения env-файла.

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
scp docker/compose.yml docker/compose.prod.yml docker/compose.backup.yml deploy@<IP>:/opt/pharmacy/docker/
```

## 4. Запуск

Если в выкладке есть миграции — сначала снимок диска в панели Contabo (откат миграций только так, ADR-0006: только Up).

```bash
ssh deploy@<IP>
export IMAGE_TAG=<sha>
dc up -d --no-build --wait postgres
dc exec -T postgres psql -q -v ON_ERROR_STOP=1 -U postgres -d pharmacy -f /docker-entrypoint-initdb.d/04-backup-role.sql
dc up -d --no-build --wait && echo "$IMAGE_TAG" > /opt/pharmacy/image-tag
dc ps
```

Второй шаг `npm run stack -- prod up` делает сам: создаёт или обновляет роль `pharmacy_backup` по паролю из env-файла
(ADR-0019). `image-tag` — тег работающей выкладки для `dc` в следующих сессиях.

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

## 6. Первый оператор и сеть

Как в CLAUDE.md, раздел «Containers»: `create-operator.mjs`, затем `create-activation-code.mjs` — командой
`dc run --rm --no-deps api node scripts/<скрипт> …` с тем же `IMAGE_TAG`.

## 7. Откат

Прежний тег — вместе с compose-файлами его коммита: новые файлы могут требовать сервис или образ, которого у прежнего
тега нет. На своей машине:

```bash
for f in compose.yml compose.prod.yml compose.backup.yml; do git show <прежний sha>:docker/$f | ssh deploy@<IP> "cat > /opt/pharmacy/docker/$f"; done
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
ssh deploy@<IP> 'cd /opt/pharmacy && IMAGE_TAG=$(cat image-tag) docker compose --project-name pharmacy-prod --env-file docker/env/prod.env -f docker/compose.yml -f docker/compose.prod.yml -f docker/compose.backup.yml run --rm --no-deps -T backup pharmacy-backup verify-offsite <копия>' < key.txt
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
`dc exec -T postgres psql -U postgres -d postgres -c "drop database pharmacy_before_<копия>"`. Пароли и PIN
восстановленной базы работают только с pepper её env-файла (ADR-0008).

## Новый сервер вместо потерянного

1. Раздел 1 — новый VPS; DNS — на его IP.
2. Env-файл — из бакета: последний объект `prod/env/<время>.env.age` (панель Contabo или `aws s3 cp` ключами S3 из
   менеджера паролей), расшифровать закрытым ключом хранителя, например
   `docker run --rm -i --pull=never -v "$PWD:/w" pharmacy/postgres:<sha> age -d -i /dev/stdin -o /w/prod.env /w/<время>.env.age < key.txt`;
   положить на хост как в разделе 2.
3. Раздел 3 — образы и compose-файлы того коммита, что работал (или новее).
4. Только PostgreSQL: `export IMAGE_TAG=<sha>; dc up -d --no-build --wait postgres` (полный `up` не нужен: защита пустой
   базы не даст копировать пустую базу поверх истории копий, B15).
5. Имя последней копии и сама копия — из бакета; закрытый ключ идёт по ssh в stdin и на диск сервера не попадает:

   ```bash
   ssh deploy@<IP> 'cd /opt/pharmacy && IMAGE_TAG=<sha> docker compose --project-name pharmacy-prod --env-file docker/env/prod.env -f docker/compose.yml -f docker/compose.prod.yml -f docker/compose.backup.yml run --rm --no-deps -T backup pharmacy-backup list-offsite'
   ssh deploy@<IP> 'cd /opt/pharmacy && IMAGE_TAG=<sha> docker compose --project-name pharmacy-prod --env-file docker/env/prod.env -f docker/compose.yml -f docker/compose.prod.yml -f docker/compose.backup.yml run --rm --no-deps -T backup pharmacy-backup fetch <копия>' < key.txt
   ```

6. Дальше — раздел «Восстановление из копии» выше и шаг 4 целиком.
