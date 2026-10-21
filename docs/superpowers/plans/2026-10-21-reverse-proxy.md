# Reverse proxy (ADR-0012) и хостинг (ADR-0020): план реализации

**Goal:** test и prod поднимаются одним `npm run stack` с Caddy впереди: HTTPS, статика web/admin из образа
`pharmacy/proxy`, `/api` на тот же origin; prod готов к выкладке на VPS `nurmed.online`.

**Основа:** ADR-0012 (accepted 2026-10-21, раздел «Принятие»), ADR-0020. Спецификации нет — ADR достаточно подробен.

**Вне плана:** копии вне хоста (`age` + `rclone`) — вместе с сервисом `backup` ADR-0019 (ветка `feature/db-backups`);
офлайн-профиль пишется, но не проверяется вживую (офлайн-точек на пилоте нет); подготовка VPS — runbook после PR.

## Global Constraints

- Тесты отложены до MVP; проверка живая — локальный test-стек с `tls internal` на `*.localhost`.
- Ветка `feature/hosting-proxy` (worktree `pharmacy-hosting`); основной каталог занят другой сессией.
- Новых npm-зависимостей нет; предсжатие — `node:zlib`.
- Образы базовые — по версии и digest (ADR-0005): `caddy:2.11.7-alpine@sha256:d8542f48…`, node — тот же, что у
  `apps/api/Dockerfile`.

## Tasks

1. **Service Worker без карт.** `tools/scripts/build-sw.mjs` не включает `*.map` в манифест (их нет в образе proxy —
   `cache.addAll` упал бы на 404).
2. **Предсжатие.** `tools/scripts/precompress.mjs <dir…>`: удаляет `*.map`, пишет `.br` и `.gz` для
   `js/css/html/txt/svg/json/ico` больше 1 КБ, если сжатие выгодно.
3. **Образ proxy.** `docker/proxy/Dockerfile` (build: `npm ci` → `nx run-many -t build -p web admin` → precompress;
   runtime: Caddy + `/srv/web`, `/srv/admin`), `Caddyfile` (глобальные таймауты, `admin off`, сниппеты static/api/
   заголовки/TLS-режимы, health `:8081`), профили `cloud`, `local`, `offline`.
4. **Compose и скрипт.** Сервис `proxy` в `docker/compose.yml` (тома `/data`, `/config`, healthcheck, зависимость от
   `api`); порт API убран из базового файла, в test — только `127.0.0.1` для диагностики; в prod — 80/443/443-udp на
   `PROXY_BIND_ADDR`; env-примеры с адресами `nurmed.online` и `*.localhost`; `stack.mjs` — статику собирает образ.
5. **API.** `helmet` без HSTS (источник — proxy); `TRUST_PROXY=1` в примерах env.
6. **Живая проверка** (test-стек): HTTPS web/admin, `/stock` → `stock.html`, 404, кэш-заголовки, `.br`, CSP без
   ошибок консоли, вход и cookie `__Host-sid`, `/api/v1/operator/*` на `app.` → 404, не-operator на `admin.` → 404,
   лимит 1 MB → 413, `X-Forwarded-For` доходит до API (`req.ip`), регистрация `sw.js`.
7. **Документы.** CLAUDE.md (стек, Environments, Containers), скилы `nestjs-api` (HSTS на proxy),
   `web-performance-optimization`, `react-dev` (ссылки на ADR-0012), runbook выкладки на VPS `docs/guides/`.

## Review Focus

1. Ни один путь не отдаёт чужую страницу (нет SPA-fallback), `404.html` со статусом 404.
2. Cookie `__Host-*` web не уходят на `admin.` и наоборот; операторский контур недоступен с `app.`.
3. Секреты не попадают в build-контекст образа proxy (`.dockerignore`).
4. HSTS — только `acme`/`files`; на `local` и `offline` его нет.
