# ADR-0012: Reverse proxy и раздача статики web/admin — Caddy, одна конфигурация для облака и офлайн-точки

- **Статус:** proposed
- **Дата:** 2026-09-29
- **Авторы:** Zohid Saidov (z.saidov@eskhata.com), команда проекта Pharmacy (черновик подготовлен с помощью AI)
- **Принимает:** архитектор проекта (docs/architecture/APPROVAL.md)

## Контекст

`apps/web` и `apps/admin` — Next.js со статическим экспортом (`output: 'export'`, ADR-0004): в
проде серверного рантайма Next нет, сборка — файлы в `apps/*/out`. По C4 deployment reverse proxy —
единственная точка входа по HTTPS: отдаёт статику web и admin (admin — отдельный поддомен),
проксирует `/api` на NestJS в приватной сети; API stateless и масштабируется добавлением
инстансов. Сейчас proxy нет: в dev `/api/*` проксирует dev-сервер Next (`rewrites`), в test/prod
(`docker/compose.{test,prod}.yml`, `tools/scripts/stack.mjs`) API опубликован на `127.0.0.1`, а
статика собирается, но никем не раздаётся (комментарии «future ADR-0012» в compose и stack.mjs).

Ограничения, которые определяют выбор:

- **Три места развёртывания, одна схема.** Облако test/prod (хостинг не выбран — вопрос № 1
  stack.md; сейчас обе среды поднимаются локально через docker compose) и офлайн-дистрибутив
  точки (ADR-0005): один ПК аптеки, Windows 10/11 + WSL2 или Linux, ≥ 8 ГБ ОЗУ, браузер →
  `localhost`, без интернета, состав web + API + PostgreSQL, **без Redis**.
- **Cookie на одном origin (ADR-0008, proposed).** Черновик ADR-0008 выбирает HttpOnly-cookie
  `__Host-sid` (`Secure; HttpOnly; SameSite=Strict; Path=/`) на origin web и `__Host-op_sid` на
  origin admin, CSRF — через `Sec-Fetch-Site`/`Origin`, CORS выключен. Это требует, чтобы SPA и
  `/api` жили на одном origin — именно это даёт proxy. Префикс `__Host-` требует `Secure` и
  host-only cookie; Chrome считает `http://localhost` потенциально безопасным контекстом и
  принимает на нём `Secure`-cookie, но **отклоняет префиксы `__Host-`/`__Secure-` на
  `http://localhost`** (Firefox принимает; расхождение описано в httpwg/http-extensions #2605) —
  поэтому ADR-0008 на офлайн-точке использует имена без префикса. Если ADR-0008 будет принят с
  другим транспортом (Bearer-токен), proxy по-прежнему нужен для TLS, статики и заголовков, а
  требование «один origin» становится желательным, а не обязательным.
- **Статический экспорт Next.** Каждый маршрут — отдельный HTML (`/stock` → `stock.html` при
  `trailingSlash: false`), плюс `404.html` и RSC-payload `*.txt` для клиентской навигации.
  `headers`, `rewrites`, `redirects` из `next.config.js` в экспорте **не работают** — заголовки
  безопасности и кэширования может выставить только сервер статики. В `index.html` текущей
  сборки (Next 16.1) есть inline-`<script>` (RSC-payload `self.__next_f.push`) — строгая CSP без
  `'unsafe-inline'` требует хешей, nonce невозможен без сервера. Хешированные ассеты —
  `/_next/static/*`; HTML и `*.txt` не хешированы. В `out/` попадают `*.map`.
- **Нагрузка и SLA:** 3 тенанта, ~30 точек, до 50 одновременных кассиров (×5 запас), касса ≤ 1 сек,
  99,5 % в рабочие часы — proxy не должен быть заметной задержкой, но и высоконагруженных
  требований (десятки тысяч RPS) нет. Синхронизация офлайн-точек (очередь операций за сутки) и
  загрузка CSV в черновик документа дают крупные тела запросов; выгрузка 1С — крупный *ответ*
  (файл CommerceML), по скилу `nestjs-api` она строится задачей очереди, а не долгим запросом.
- Правила ADR-0011: без самописной криптографии (TLS и сертификаты — только штатными средствами
  proxy), без внешних SaaS для данных тенантов (CDN/облачный edge-прокси чужой компании, через
  который идут cookie и данные тенантов, не рассматривается), закрытый список интеграций
  (ACME-УЦ — не интеграция с данными, но исходящий вызов из облака; фиксируется здесь).

## Рассмотренные варианты

Критерии (по весу для этого проекта):

- К1. TLS: автоматический Let's Encrypt/ACME при неизвестном хостинге; возможность подложить
  свой сертификат или работать за TLS-балансировщиком хостинга; на офлайн-точке — `http://localhost`.
- К2. Одна конфигурация и один образ для test/prod/офлайн; различия — только переменными окружения.
- К3. Статический экспорт: `try_files` на `{path}.html`, `404.html`, без ложного SPA-fallback.
- К4. Кэширование (`immutable` для `/_next/static/*`, `no-cache` для HTML/`*.txt`), gzip/brotli.
- К5. Заголовки безопасности (CSP, HSTS, nosniff, frame-ancestors), лимиты тела, таймауты,
  health, структурированные логи без секретов.
- К6. Размер образа и потребление памяти на ПК точки; лицензия; простота конфигурации для
  небольшой команды без выделенного DevOps.

**Ось A. Чем раздавать статику и проксировать `/api`**

1. **nginx 1.30 (stable, апрель 2026), образ `nginx:1.30-alpine`** — BSD-2-Clause, самый
   распространённый и знакомый вариант; образ ≈ 25 МБ сжатый (`alpine-slim` ≈ 5,5 МБ). Плюсы:
   зрелость, производительность с большим запасом, документация Next.js даёт готовый пример
   (`try_files $uri $uri.html $uri/ =404`, `error_page 404 /404.html`), `gzip` и `gzip_static`
   встроены, HTTP/3, шаблоны `/etc/nginx/templates/*.template` + envsubst в официальном образе.
   Минусы: ACME — нативный `ngx_http_acme_module` только в отдельном пакете `nginx-module-acme`
   (анонс 2025, статус preview), в официальном Docker-образе на момент проверки отсутствует —
   значит свой образ с модулем либо certbot/acme.sh-сайдкар + reload по расписанию; brotli —
   сторонний модуль `ngx_brotli` (свой билд); известная ловушка `add_header` (вложенный
   `location` молча сбрасывает унаследованные заголовки безопасности); таймауты и лимиты по
   умолчанию (`client_max_body_size 1m`, `proxy_read_timeout 60s`) надо помнить и переопределять.
2. **Caddy 2.11 (актуальная 2.11.4, июнь 2026), образ `caddy:2.11-alpine`** — Apache 2.0, Go
   (memory-safe); образ ≈ 23 МБ сжатый. Плюсы: автоматический HTTPS «из коробки» (ACME Let's
   Encrypt/ZeroSSL, выпуск и продление, редирект HTTP→HTTPS), `tls internal` — локальный УЦ для
   `*.localhost`, явный `http://`-адрес отключает TLS (офлайн-точка); `{$VAR:default}`
   подставляются **до разбора Caddyfile** и могут раскрываться в целые токены/строки — одна
   конфигурация на все среды; `file_server { precompressed br gzip }` отдаёт заранее сжатые
   `.br`/`.gz`, `encode zstd gzip` сжимает на лету (JSON API); `try_files`, `handle_errors`,
   `request_body { max_size }`, JSON-логи в stdout, заголовки `Cookie`/`Set-Cookie`/
   `Authorization` в access-логах по умолчанию `REDACTED`; недоверенные входящие
   `X-Forwarded-*` игнорируются (`trusted_proxies` пуст по умолчанию). Минусы: у команды нет
   опыта; brotli на лету нет (только предсжатые файлы); серверные таймауты `read_header`,
   `read_body`, `write` **по умолчанию отсутствуют** — задавать явно; admin-API на `:2019`
   нужно отключить (`admin off` → перезагрузка конфига только рестартом контейнера); каталог
   `/data` (сертификаты, ключ ACME-аккаунта, локальный УЦ) обязан быть постоянным томом — иначе
   повторный выпуск и риск упереться в лимиты Let's Encrypt; «магия» автоматического HTTPS
   может удивить при нестандартном хостинге (за балансировщиком — явно `http://` + `trusted_proxies`).
3. **Traefik v3, образ `traefik:v3`** — MIT, автообнаружение сервисов по Docker-меткам, ACME
   встроен. Минусы: **не раздаёт статические файлы** (запрос на file server отклонён
   проектом; есть только сторонний плагин Statiq) — рядом всё равно нужен nginx/Caddy, т.е. два
   компонента вместо одного; образ ≈ 53 МБ; сильная сторона (динамическое обнаружение десятков
   сервисов) для фиксированной топологии «proxy + API» не нужна.
4. **HAProxy 3.2 LTS, образ `haproxy:3.2-alpine`** — GPLv2 (использование без ограничений),
   ≈ 17 МБ, лучший L7-балансировщик и наблюдаемость. Минусы: не веб-сервер — статику отдаёт
   только как `errorfile`/`http-request return` (не для сотен файлов с MIME и предсжатием),
   нужен второй компонент; встроенный ACME-клиент в 3.2 — experimental; конфигурация
   заголовков/SPA-маршрутизации самая многословная.
5. **Без отдельного proxy: статику раздаёт сам NestJS (`@nestjs/serve-static`)** — один
   контейнер меньше, один origin автоматически. Минусы: TLS и сертификаты — вручную в Node
   (`https.createServer` + свой цикл продления) либо всё равно внешний терминатор; Node-процесс
   API публичен напрямую (C4 требует API только в приватной сети); два хоста (web/admin) с
   разной статикой и CSP — собственный host-based middleware; раздача, сжатие и кэш-заголовки
   нагружают тот же event loop, что и касса (≤ 1 сек); при масштабировании «добавлением
   инстансов» перед ними всё равно нужен балансировщик; версии пакета привязаны к мажору Nest
   (последняя 12.0.0 требует `@nestjs/core` ^12, в репозитории сейчас ^11). Разумен только для
   офлайн-точки — но тогда у облака и точки разные топологии и две схемы заголовков.

**Ось B. Схема доменов**

1. **web и admin — разные хосты одного домена** (`app.<домен>` и `admin.<домен>`; или web на
   apex). `__Host-`-cookie host-only → cookie web не уходит на admin и наоборот; у каждого хоста
   своя CSP и свой набор разрешённых путей `/api`. Минус: хосты same-site → `SameSite=Strict` не
   защищает от запросов между ними; защита — проверка `Origin`/`Sec-Fetch-Site` и привязка
   cookie к origin в API (так и заложено в ADR-0008).
2. **admin по пути `/admin` на том же origin** — один сертификат и одна DNS-запись. Минусы
   (решающие): один origin = нет изоляции — XSS в клиентском продукте читает DOM админки и шлёт
   запросы с operator-cookie; `__Host-` требует `Path=/`, т.е. разделить cookie путём нельзя; CSP
   и `frame-ancestors` по пути не изолируют; нарушает C4 deployment и ADR-0008. Отклонён.
3. **admin на отдельном регистрируемом домене** (например `<домен-оператора>`) — cross-site
   изоляция: `SameSite=Strict` начинает работать между продуктами. Минусы: второй домен
   (покупка, DNS, продление, ещё одна зона HSTS); handoff «вход от имени» (ADR-0008 —
   top-level POST из админки на origin web) становится cross-site и `SameSite=Strict` cookie web
   на первом запросе не придёт — это не мешает (сессия выдаётся ответом), но протокол надо
   перепроверить. Кандидат на усиление после MVP.

**Ось C. Как proxy получает статику**

1. **Статика внутри образа proxy (multi-stage build)** — стадия `node` выполняет
   `npm ci` + `npx nx run-many -t build -p web admin` и предсжатие, финальная стадия `caddy`
   копирует `apps/web/out` → `/srv/web`, `apps/admin/out` → `/srv/admin`. Плюсы: один
   неизменяемый образ `pharmacy/proxy:<git-sha>` = конфиг + ровно та сборка фронтендов;
   воспроизводимо (как `apps/api/Dockerfile`); офлайн-комплект — на один образ проще (флешка).
   Минусы: любой релиз фронтенда пересобирает образ proxy; сборка Next внутри Docker дублирует
   сборку на хосте в `stack.mjs` (время); релизы web и admin связаны одним тегом.
2. **Отдельные образы web и admin со своим статическим сервером за proxy** — независимые
   релизы. Минусы: три контейнера и лишний сетевой хоп ради раздачи файлов; три конфигурации
   заголовков; на офлайн-точке лишний контейнер.
3. **Том/bind-mount с хоста** (`apps/*/out` монтируется в proxy) — быстро локально. Минусы:
   образ не описывает версию фронтенда (что запущено — зависит от состояния диска), для
   облака и флеш-комплекта не годится; `.dockerignore` уже исключает `**/out`.

## Решение

Рекомендуется (решение принимает архитектор проекта): **A2 — Caddy 2.11** как единственная
точка входа во всех трёх местах развёртывания, **B1 — web и admin на разных хостах одного
домена**, **C1 — статика запечена в образ proxy multi-stage-сборкой**. Caddy закрывает К1 и К2
лучше остальных: при неизвестном хостинге одна строка адреса даёт Let's Encrypt с продлением,
`tls internal` — HTTPS на `*.localhost` для локальных test/prod, `http://localhost` — офлайн-точку,
и всё это одним Caddyfile с переменными окружения. nginx — полноценная запасная альтернатива
(та же схема, но ACME сайдкаром и свой билд для brotli); Traefik и HAProxy отклонены, так как не
раздают статику и потребовали бы второй компонент; раздача из NestJS отклонена, так как открывает
API наружу и нагружает event loop кассы.

**Схема доменов и маршрутизации** (имена доменов — после выбора хостинга, вопрос № 1):

| Хост | Что отдаёт | Cookie (ADR-0008) | Особенности |
|---|---|---|---|
| `app.<домен>` | `/srv/web` + `/api/*` → `api:3000` | `__Host-sid`, `__Host-term` | `/api/v1/operator/*` на этом хосте → 404 на уровне proxy (эшелон; основная проверка — в API); сюда же синхронизация офлайн-точек `/api/v1/sync/*` с увеличенным лимитом тела (протокол — черновик ADR-0014) |
| `admin.<домен>` | `/srv/admin` + `/api/*` → `api:3000` | `__Host-op_sid` | CSP `form-action 'self' https://app.<домен>` (handoff «вход от имени»); опционально — allowlist IP операторов (`remote_ip`) |
| apex `<домен>` | редирект на `app.` (или лендинг — вне этого ADR) | — | держим свободным, чтобы web/admin были симметричны |
| Локально test/prod (сейчас) | `https://pharmacy-test.localhost:<порт>`, `https://admin.pharmacy-test.localhost:<порт>` (аналогично `pharmacy-prod`) — `tls internal` | `__Host-*` (проверяется «боевой» путь cookie) | Chrome/Edge резолвят `*.localhost` в loopback; корневой сертификат локального УЦ Caddy из тома `/data` один раз доверить на машине |
| Офлайн-точка | `http://localhost` → `/srv/web` + `/api/*` → локальный API; `127.0.0.1` → редирект на `localhost` | `sid`, `term` (без префикса) | порт публикуется только на `127.0.0.1`; admin не обслуживается; TLS нет (localhost — потенциально безопасный контекст, самоподписанный сертификат на каждом ПК не даёт выгоды, но требует установки корня и продления); доступ по LAN — вне ADR (ADR-0008) |

**Параметры proxy** (стартовые значения — откалибровать на test):

| Тема | Решение |
|---|---|
| TLS | Профиль `TLS_MODE`: `acme` (облако, Let's Encrypt, `ACME_EMAIL`), `internal` (локальные test/prod), `files` (сертификат хостинга/собственный из смонтированного каталога), `off` (офлайн или за TLS-балансировщиком хостинга — тогда `trusted_proxies` на его подсеть). HTTP/3 — по умолчанию Caddy, в облаке публиковать `443/udp` |
| Статика | `try_files {path} {path}.html {path}/index.html`, ошибки → `404.html` (`handle_errors 404`). **SPA-fallback на `index.html` не делаем**: при экспорте Next каждому маршруту свой HTML, fallback отдавал бы чужую страницу. `trailingSlash` остаётся `false`. Динамические сегменты (`/receipts/[id]`) в экспорте без `generateStaticParams` невозможны — идентификаторы передаются query-параметром или клиентским состоянием (правило для `react-dev`) |
| Кэш | `/_next/static/*` — `Cache-Control: public, max-age=31536000, immutable`; HTML, `*.txt` (RSC-payload), `favicon` — `no-cache` (ETag/Last-Modified от `file_server`); `/api/*` — заголовки задаёт API. Совпадает со скилом `web-performance-optimization` |
| Сжатие | На стадии сборки — предсжатие `.br` и `.gz` для `js/css/html/txt/svg/json` скриптом на `node:zlib` (без новых зависимостей); `file_server { precompressed br gzip }`; `encode zstd gzip` — для ответов API. `*.map` удаляются из образа |
| Заголовки (статика) | CSP: `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'` (+ web-origin у admin). `'unsafe-inline'` для скриптов — вынужденная мера из-за inline RSC-payload; цель после MVP — хеши inline-скриптов, генерируемые на сборке. Плюс `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Cross-Origin-Opener-Policy: same-origin`, `Permissions-Policy` (запрет camera/microphone/geolocation, пока не нужны). Заголовки `/api` — helmet в API (скил `nestjs-api`) |
| HSTS | Только профиль `acme`/`files` в облаке: `max-age=31536000; includeSubDomains`, без `preload` на MVP. Источник HSTS — proxy; в helmet API отключить, чтобы не дублировать |
| Лимиты тела | По умолчанию `/api/*` — 1 MB; `/api/v1/sync/*` — 4 MB (черновик ADR-0014: батч ≤ 2 МБ JSON после распаковки, тело приходит `Content-Encoding: gzip` — proxy пропускает его как есть, лимит распакованного тела проверяет body-parser); загрузка CSV — по лимиту эндпоинта (`MAX_BYTES` скила) + запас. **Лимит body-parser в Nest (Express по умолчанию 100 kB для JSON) согласовать с лимитами proxy** — меньший молча побеждает |
| Таймауты | Сервер: `read_header 10s`, `read_body 60s`, `write 120s`, `idle 2m` (у Caddy по умолчанию их нет). Upstream: `dial_timeout 5s`, `response_header_timeout 30s` (синхронизация — 120s). Долгие операции (выгрузка 1С) — задачей очереди + скачивание готового файла, не удлинением таймаутов |
| Клиентский IP | Caddy передаёт `X-Forwarded-For/Proto/Host`; в API — `app.set('trust proxy', 1)` (за балансировщиком хостинга — 2 или подсеть), иначе throttling входа/PIN (ADR-0008) считает всех клиентов одним IP |
| Health | Внутренний слушатель `:8081/healthz` (не публикуется) для `HEALTHCHECK` контейнера; `depends_on: api: service_healthy`. Readiness API (`/api/health/ready`) наружу не отдавать или отдавать без деталей |
| Логи | JSON access-лог в stdout → драйвер `json-file` с ротацией (`x-logging` в compose); `Cookie`/`Authorization` редактируются Caddy по умолчанию, `log_credentials` не включать; query-строки не содержат секретов (правило ADR-0008) |
| Admin API Caddy | `admin off`; изменение конфигурации = новый образ/рестарт |

**Раскладка файлов** (создаются в PR реализации после `accepted`, не этим ADR):

```
docker/proxy/
├── Dockerfile               # stage build: node (тот же NODE_IMAGE с digest, что apps/api) →
│                            #   npm ci → npx nx run-many -t build -p web admin →
│                            #   node tools/scripts/precompress.mjs → удалить *.map;
│                            # stage runtime: caddy:2.11.x-alpine@sha256:<pin> ← Caddyfile, /srv/web, /srv/admin
├── Caddyfile                # global options (admin off, timeouts, trusted_proxies),
│                            #   сниппеты (static), (api), (headers), (tls-acme|internal|files|off),
│                            #   import profiles/{$PROXY_PROFILE}.caddy
└── profiles/
    ├── cloud.caddy          # {$WEB_ADDR} и {$ADMIN_ADDR}: static + api + headers + HSTS
    └── offline.caddy        # http://localhost: только web + api; 127.0.0.1 → localhost
tools/scripts/precompress.mjs  # .br/.gz через node:zlib
```

Эскиз ключевых фрагментов (иллюстрация, финальный текст — в PR):

```caddyfile
{
	admin off
	servers {
		timeouts {
			read_header 10s
			read_body 60s
			write 120s
			idle 2m
		}
	}
}

(static) {
	root * /srv/{args[0]}
	header /_next/static/* Cache-Control "public, max-age=31536000, immutable"
	header ?Cache-Control "no-cache"
	try_files {path} {path}.html {path}/index.html
	file_server {
		precompressed br gzip
	}
	handle_errors 404 {
		rewrite * /404.html
		file_server
	}
}

(api) {
	handle /api/v1/sync/* {
		request_body {
			max_size {$SYNC_MAX_BODY:4MB}
		}
		encode zstd gzip
		reverse_proxy {$API_UPSTREAM:api:3000}
	}
	handle /api/* {
		request_body {
			max_size {$API_MAX_BODY:1MB}
		}
		encode zstd gzip
		reverse_proxy {$API_UPSTREAM:api:3000} {
			transport http {
				dial_timeout 5s
				response_header_timeout 30s
			}
		}
	}
}

import /etc/caddy/profiles/{$PROXY_PROFILE}.caddy
```

**Встраивание в compose и скрипты:**

- `docker/compose.yml`: новый сервис `proxy` (`build: { context: .., dockerfile: docker/proxy/Dockerfile }`,
  `image: pharmacy/proxy:${IMAGE_TAG}`, переменные `PROXY_PROFILE`, `TLS_MODE`, `WEB_ADDR`,
  `ADMIN_ADDR`, `ACME_EMAIL`; тома `proxy-data:/data`, `proxy-config:/config`; healthcheck;
  `depends_on: api: service_healthy`; `logging: *logging`). У `api` из базового файла убрать `ports`.
- `docker/compose.prod.yml`: `proxy` публикует `80`, `443`, `443/udp` (в облаке) — сейчас, пока prod
  локален, порты из env-файла; **API наружу не публикуется**. `docker/compose.test.yml`: порты proxy
  из env; публикация API на `127.0.0.1` — только для диагностики, по желанию.
- `docker/env/*.env.example`: `PROXY_HTTP_PORT`, `PROXY_HTTPS_PORT`, `WEB_ADDR`, `ADMIN_ADDR`,
  `TLS_MODE`, `ACME_EMAIL`, а для API — `PUBLIC_WEB_ORIGIN`, `PUBLIC_ADMIN_ORIGIN` (разрешённые
  origin для CSRF-проверки ADR-0008) из тех же значений — один источник правды.
- `tools/scripts/stack.mjs`: шаг «static export on host» становится проверкой качества (или
  убирается), статику собирает Dockerfile proxy; `up --wait` ждёт и proxy.
- Офлайн-дистрибутив (волна 3): тот же образ `pharmacy/proxy:<tag>`, `PROXY_PROFILE=offline`,
  `TLS_MODE=off`, `API_UPSTREAM=api:3000`, публикация `127.0.0.1:${PROXY_HTTP_PORT:-80}:80`.
- dev: без изменений — `next dev` + `rewrites` на `:3000`. Проверка связки proxy + cookie — на
  test-стенде.

## Последствия

- Положительные:
  - один компонент и один образ закрывают TLS, статику, `/api`, заголовки и кэш во всех трёх
    средах; облако и офлайн-точка различаются только переменными (`PROXY_PROFILE`, `TLS_MODE`);
  - автоматический Let's Encrypt не зависит от выбора хостинга; если хостинг даст свой сертификат
    или TLS-балансировщик — переключение профилем `files`/`off`, без смены компонента;
  - один origin для SPA и `/api` — обязательное условие cookie-транспорта ADR-0008 (если он будет
    принят); CORS не нужен; хосты web/admin изолированы host-only cookie и отдельными CSP;
  - API остаётся в приватной сети compose, масштабирование — добавлением upstream в `reverse_proxy`
    (балансировка встроена);
  - образ proxy фиксирует точную пару «конфигурация + сборка фронтендов» по git-sha — откат
    фронтенда = откат тега; офлайн-комплект на флешке — плюс один маленький образ (≈ 23 МБ);
  - правильные кэш-заголовки и предсжатые br/gz ускоряют первую загрузку кассы и обновление
    офлайн-точки после релиза (HTML `no-cache` — новая сборка подхватывается сразу).
- **Отрицательные (обязательно):**
  - новый для команды компонент (Caddy): нужен навык чтения Caddyfile, JSON-логов и поведения
    автоматического HTTPS; nginx был бы привычнее большинству администраторов хостинга;
  - «магия» автоматического HTTPS: при ошибке DNS или закрытом 80-м порту выпуск сертификата
    падает на старте; каталог `/data` — обязательный постоянный том с приватным ключом
    ACME-аккаунта и ключами сертификатов (бэкап, права), его потеря = перевыпуск и риск лимитов
    Let's Encrypt; исходящий доступ из облака к ACME-УЦ;
  - нет штатных серверных таймаутов — забытая настройка = уязвимость к медленным клиентам;
    `admin off` исключает горячую перезагрузку конфигурации (только рестарт, на VM — секунды
    простоя входа, если proxy один);
  - brotli только предсжатием на сборке — свой небольшой скрипт `precompress.mjs` на
    сопровождении; ответы API — только zstd/gzip;
  - CSP со `script-src 'unsafe-inline'` на старте — слабее, чем хотелось бы (inline RSC-payload
    Next); ужесточение хешами — отдельная работа после MVP;
  - запрет SPA-fallback и динамических сегментов накладывает ограничение на роутинг web/admin
    (id — в query), это нужно закрепить в правилах фронтенда до начала экранов;
  - сборка Next внутри Docker: дольше `stack build`, фронтенды web и admin релизятся одним
    тегом образа; любое изменение CSS пересобирает образ proxy;
  - локальные test/prod на `*.localhost` с `tls internal` требуют один раз доверить корневой
    сертификат локального УЦ Caddy (для каждого тома своего) на машине разработчика; dev
    (`localhost:4200/4300`) cookie-изоляцию web/admin не воспроизводит — она проверяется только
    на test;
  - два имени cookie (облако `__Host-*`, офлайн — без префикса) остаются следствием
    `http://localhost`; при появлении доступа к офлайн-точке по LAN понадобится TLS в LAN —
    отдельный ADR;
  - два хоста одного домена — same-site: `SameSite=Strict` не отделяет web от admin, защита
    держится на проверке `Origin`/`Sec-Fetch-Site` в API и маршрутных запретах proxy;
  - `.dockerignore` не исключает `docker/env/*.env`: `COPY . .` в стадии сборки (уже в
    `apps/api/Dockerfile`, будет и в proxy) затягивает секреты сред в build-контекст и кэш
    слоёв — исправить вместе с реализацией.
- Что обновить после перевода в `accepted` (в рамках этого ADR файлы не редактируются):
  - `docs/architecture/stack.md` — строка «Reverse proxy: Caddy 2.11 — ADR-0012» в разделе 3;
    версия образа в разделе 5;
  - `docs/architecture/c4/deployment.md` — контейнер proxy: «Caddy, TLS (ACME), статика web/admin
    в образе»; строки web/admin — «в образе proxy», а не отдельные контейнеры; офлайн-точка —
    добавить proxy в «Состав»; `c4/container.md` — технология proxy в легенде; PNG в `img/`;
  - `CLAUDE.md` — таблица стека (Reverse proxy — ADR-0012), раздел «Environments»: адреса
    test/prod, доверие к локальному УЦ, `npm run stack`;
  - `docker/compose.yml`, `compose.test.yml`, `compose.prod.yml`, `docker/env/*.env.example`,
    `tools/scripts/stack.mjs`, `.dockerignore` — по разделу «Встраивание»; убрать комментарии
    «future ADR-0012»;
  - `apps/api/src/main.ts` — `trust proxy`, лимиты body-parser, helmet без HSTS;
  - скил `nestjs-api` (`nestjs-enterprise-infrastructure.md`: HSTS — на proxy; `trust proxy`;
    лимиты тела и таймауты согласованы с proxy), скил `web-performance-optimization`
    (кэш и сжатие — ссылка на ADR-0012), скил `react-dev` (без динамических сегментов в
    экспорте, id — в query, без SPA-fallback);
  - ADR-0008 (если принят) — ссылка на ADR-0012 как на реализацию «одного origin».

Спорные моменты для решения архитектором проекта:

1. Caddy против nginx: выигрыш в автоматическом TLS и одной конфигурации против привычности
   nginx у будущих администраторов хостинга. Если хостинг даст TLS-балансировщик и сертификаты,
   преимущество Caddy сужается.
2. Web на `app.<домен>` или на apex; нужен ли admin на отдельном регистрируемом домене
   (cross-site изоляция) уже в MVP, и нужен ли allowlist IP операторов на `admin.`.
3. Стартовые лимиты тела (`/api` 1 MB, синхронизация 4 MB) и таймауты — согласовать с лимитами батча ADR-0014 после
   его принятия.
4. Допустим ли на MVP `script-src 'unsafe-inline'` или сразу делать генерацию хешей inline-скриптов.
5. Локальные test/prod: HTTPS на `*.localhost` с `tls internal` (проверяется `__Host-`) или
   `http://localhost` с офлайн-именами cookie (проще, но «боевой» путь cookie не проверяется до
   облака).
