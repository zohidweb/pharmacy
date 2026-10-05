# Аутентификация, часть 2 — ручная проверка терминала и PIN

Новых автотестов для части 2 нет: тесты отложены до MVP, см. раздел «Долг по тестам» в
`2026-10-05-auth-part2.md`. Этот сценарий проверяет вручную счастливый путь и пункты Review Focus 1–5.
Все команды — bash (Git Bash), из корня репозитория; данные только синтетические.

## Подготовка

1. Зависимости и миграции: `npm run dev:deps`, `npx nx run api:migrate`.
2. Сборка и запуск API с тестовыми cookie (`sid`/`term` без `Secure` — иначе curl не отправит их по
   http). Переменные окружения процесса важнее значений из `.env`:

   ```bash
   npx nx build api
   APP_ENV=test AUTH_TEST_COOKIES=true node --env-file=.env apps/api/dist/main.js
   ```

3. Во втором терминале:

   ```bash
   API=http://127.0.0.1:3000/api/v1
   H=(-H "Origin: http://localhost:4200" -H "Content-Type: application/json")
   LOGIN=<логин владельца тестовой сети в dev-БД>
   ```

4. Пароль владельца: код активации и `POST /activations` (код печатается один раз):

   ```bash
   node --env-file=.env apps/api/scripts/create-activation-code.mjs --login "$LOGIN"
   curl -s -X POST $API/activations "${H[@]}" -d '{"login":"'$LOGIN'","code":"<код>","newPassword":"Smoke-Passw0rd-2026"}' -w '%{http_code}\n'
   ```

   Ожидается `204`.

## Счастливый путь

```bash
# Вход паролем (jar A — браузер заведующего)
curl -s -c a.txt -b a.txt -X POST $API/sessions "${H[@]}" -d '{"login":"'$LOGIN'","password":"Smoke-Passw0rd-2026"}'
# → 201; из ответа взять id сотрудника (employee.id → EMP) и id аптечной точки (stores[].id → STORE)

# Свой PIN (сессия по паролю, не старше 15 минут)
curl -s -c a.txt -b a.txt -X POST $API/me/pin "${H[@]}" -d '{"currentPin":null,"newPin":"4826"}' -w '%{http_code}\n'   # → 204

# Привязка этого «браузера» как терминала
curl -s -c a.txt -b a.txt -X POST $API/terminals "${H[@]}" -d '{"storeId":"'$STORE'","name":"Касса smoke"}'
# → 201 BoundTerminal (id → TERM), в a.txt появилась cookie term

curl -s -b a.txt $API/terminals/current          # → 200, в cashiers есть EMP, pinLength ≥ 4

# PIN-вход на терминале
curl -s -c a.txt -b a.txt -X POST $API/terminal-sessions "${H[@]}" -d '{"employeeId":"'$EMP'","pin":"4826"}'
# → 201 EmployeeSession, currentStore = STORE, stores — только STORE
curl -s -b a.txt $API/me -w '\n%{http_code}\n'   # → 200
curl -s -b a.txt $API/me/terminals               # → TERM с current: true
```

## Review Focus

1. **Cookie сессии без cookie устройства.** Скопировать `a.txt` в `stolen.txt`, удалить из него
   строку `term`; `curl -s -b stolen.txt $API/me` → `401`; затем `curl -s -b a.txt $API/me` → тоже
   `401` (сессия уничтожена). Снова войти по PIN, как выше.
2. **Отвязка во время работы кассира.** `cp a.txt pin.txt`. Войти паролем в новый jar `b.txt`
   (без `term`), затем
   `curl -s -b b.txt -X DELETE $API/terminals/$TERM -H "Origin: http://localhost:4200" -w '%{http_code}\n'`
   → `204`; `curl -s -b pin.txt $API/me` → `401`; `curl -s -b pin.txt $API/terminals/current` →
   `404 not_bound`; PIN-вход с `pin.txt` → `404 not_bound`.
3. **Охват PIN-сессии.** Ответ PIN-входа: `stores` — только точка терминала, даже у владельца с
   охватом «вся сеть». Маршрут с `storeQuery` другой точки (появится с модулями склада/кассы) — `403`.
4. **Неудачные PIN.** Привязать терминал заново. Три неверных PIN подряд → `401`, `401`,
   `423 pin_locked`; верный PIN → тоже `423 pin_locked`. Снять блокировку: вход паролем →
   `POST /me/pin {"currentPin":null,"newPin":"5937"}` → `204`; PIN-вход с `5937` → `201`.
   Десять неверных PIN на терминале (можно с несуществующим `employeeId`) → дальше
   `423 terminal_locked` на 15 минут.
5. **Повторная привязка того же браузера с тем же именем** — `POST /terminals` с тем же `name` из
   jar с действующим `term` → `201`, новый `id`; старый терминал отозван. Другой браузер (jar без
   `term`) с тем же именем на той же точке → `409 terminal_name_taken`.

После проверки: `rm a.txt b.txt pin.txt stolen.txt`.
