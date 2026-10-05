# Аутентификация, часть 4 — ручная проверка офлайн-точки

Автотестов к этой части нет: решено отложить их до MVP, пробелы перечислены в разделе «Долг по
тестам» файла `2026-10-05-auth-part4.md`. Вместо них — этот сценарий: основной путь и пункты
Review Focus 1–5. Команды — для bash (Git Bash), запускать из корня репозитория. Данные только
синтетические.

## Подготовка

1. `npm run dev:deps`, затем `npx nx run api:migrate`.
2. Возьмите id активной тестовой сети `TENANT` из dev-БД и логин её владельца `LOGIN`.
3. Соберите API и запустите его в офлайн-режиме с тестовыми cookie (`sid`/`term` без `Secure`):

   ```bash
   npx nx build api
   APP_ENV=test AUTH_TEST_COOKIES=true STORE_MODE=offline OFFLINE_TENANT_ID=$TENANT node --env-file=.env apps/api/dist/main.js
   ```

   В панели браузера то же самое делает конфигурация `api-offline` в `.claude/launch.json` (id сети
   там свой). `REDIS_URL` из `.env` в офлайн-режиме не используется: Redis-клиент не создаётся.
4. Во втором терминале задайте переменные:

   ```bash
   API=http://127.0.0.1:3000/api/v1
   H=(-H "Origin: http://localhost:4200" -H "Content-Type: application/json")
   ```

## Основной путь

```bash
node --env-file=.env apps/api/scripts/create-activation-code.mjs --login "$LOGIN"   # код один раз
curl -s -X POST $API/activations "${H[@]}" -d '{"login":"'$LOGIN'","code":"<код>","newPassword":"Offline-Passw0rd-2026"}' -w '%{http_code}\n'  # 204
curl -s -c o.txt -b o.txt -X POST $API/sessions "${H[@]}" -d '{"login":"'$LOGIN'","password":"Offline-Passw0rd-2026"}'   # 201, employee.id → EMP, stores[].id → STORE
curl -s -b o.txt $API/me -w '\n%{http_code}\n'                                                                           # 200
curl -s -b o.txt -X POST $API/me/pin "${H[@]}" -d '{"currentPin":null,"newPin":"4826"}' -w '%{http_code}\n'            # 204
curl -s -b o.txt -c o.txt -X POST $API/terminals "${H[@]}" -d '{"storeId":"'$STORE'","name":"Касса офлайн"}'            # 201, cookie term
curl -s -b o.txt -c o.txt -X POST $API/terminal-sessions "${H[@]}" -d '{"employeeId":"'$EMP'","pin":"4826"}'          # 201, auth: pin, одна точка
curl -s -b o.txt -c o.txt -X DELETE $API/sessions/current -H "Origin: http://localhost:4200" -w '%{http_code}\n'        # 204
```

## Review Focus

1. **Чужая сеть.**
   - Возьмите JWT из `o.txt` и запустите API с другим `OFFLINE_TENANT_ID`: тот же токен → `401`.
   - Строка `sessions` другой сети не находится: каждый запрос идёт в `withTenant(OFFLINE_TENANT_ID)` под RLS.
2. **Просроченная сессия.**
   - Выполните в БД `update pharmacy.sessions set idle_expires_at = now() - interval '1 minute'` (роль приложения, `app.tenant_id` = сеть).
   - Следующий запрос с этой cookie → `401`.
   - Новый вход удаляет просроченные строки.
3. **Без Redis.**
   - Остановите контейнер Redis (`docker stop pharmacy-dev-redis-1`) — это ваш контейнер, по желанию.
   - Основной путь проходит так же.
   - В логе нет попыток подключиться к Redis.
4. **Контур оператора.** `POST $API/operator/sessions` с `Origin: http://localhost:4300` → `404`.
5. **Лимиты.**
   - 5 неверных паролей → `429 login_locked`.
   - Три неверных PIN → `401 401 423`; верный PIN после этого → `423 pin_locked`.
   - 10 неверных PIN на терминале → `423 terminal_locked`.
   - После перезапуска процесса лимиты входа и терминала обнуляются, а блокировка PIN сотрудника остаётся.

После проверки: `rm o.txt`; если останавливали Redis — `docker start pharmacy-dev-redis-1`.
