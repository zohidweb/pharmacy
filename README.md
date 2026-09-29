# Pharmacy — SaaS-платформа автоматизации сети аптек

Мультитенантная SaaS-платформа автоматизации аптечных сетей Таджикистана: складской учёт по
партиям (FEFO, сроки годности), касса с офлайн-режимом, закупки и долги поставщикам,
цены/скидки, возвраты, отчёты, выгрузка в 1С — плюс административный контур оператора
(тенанты, биллинг, лицензионные ключи офлайн-точек, услуги). Единый репозиторий (ADR-0010):
Nx-монорепо — `apps/api` (NestJS), `apps/web` (клиентский продукт: касса, склад, кабинет
владельца), `apps/admin` (админка оператора), `libs/*` — и архитектурные артефакты в
`docs/architecture/`.

## Быстрый старт

Сборка, тесты, линт:

```
npm ci                               # установка строго по lock-файлу
npx nx run-many -t build test lint   # всё
npx nx affected -t build test lint   # только затронутое изменением
npx nx serve api                     # http://localhost:3000/api/v1/health
npx nx dev web                       # http://localhost:4200 (/api/* проксируется на :3000, только dev)
npx nx dev admin                     # http://localhost:4300
npx nx e2e api-e2e                   # e2e API (поднимает api сам)

npm run dev:deps                     # PostgreSQL + Redis в Docker (dev), затем npm run dev
npm run dev                          # api + web + admin с hot reload
```

Задачи Nx запускаются через `npx nx …`. Перед каждым PR — `npm run check` (CI пока не настроен).

Среды:

| Среда | Env-файл (не в git) | Compose-проект | API | PostgreSQL / Redis наружу |
|---|---|---|---|---|
| dev | `.env` ← `.env.example` | `pharmacy-dev` | `127.0.0.1:3000` | `5432` / `6379` на localhost |
| test | `docker/env/test.env` | `pharmacy-test` | `127.0.0.1:3100` | PostgreSQL `127.0.0.1:5433`, Redis — нет |
| prod | `docker/env/prod.env` | `pharmacy-prod` | `127.0.0.1:3200` | нет (только сеть compose) |

```
npm run stack -- <dev|test|prod> <init|build|up|down|ps|logs> [service…] [--skip-checks]
npm run stack -- test init     # env-файл из примера со случайными паролями (один раз)
npm run test-env:build         # lint + test + static web/admin + образы с тегом <git sha>
npm run test-env:up            # запуск и ожидание healthy;  test-env:down — остановка
npm run prod:build / prod:up / prod:down
```

Скрипт — `tools/scripts/stack.mjs`; compose — `docker/compose.yml` + `docker/compose.<env>.yml`.
Подробности и правила разработки — в `CLAUDE.md`.

## Архитектура

Всё в `docs/architecture/`:

- `stack.md` — профиль проекта и зафиксированный стек;
- `c4/` — C4-диаграммы (context, container, deployment; PNG в `c4/img/`);
- `glossary.md` — глоссарий домена (термины кода берутся оттуда);
- `adr/` — архитектурные решения;
- `APPROVAL.md` — результат ревью архитектуры.

## Как принимаются решения

Новая технология или библиотека уровня фреймворка, новая интеграция, новый компонент,
изменение границ модулей — сначала ADR (`/03-adr`, `docs/architecture/adr/`), потом код.
ADR создаётся в статусе `proposed` и становится решением (`accepted`) после ревью архитектора
проекта; реализовывать `proposed` нельзя. Изменения, затрагивающие утверждённую архитектуру,
отражаются в `docs/architecture/APPROVAL.md`. Правила управления — ADR-0011.

## Происхождение

Структура проекта (шаги проектирования /01–/04, шаблоны артефактов в `templates/`, гайды в
`docs/guides/`) создана по шаблону ai-project-start. Версия шаблона — в `VERSION`, его
история — в `CHANGELOG.md`.
