# Аутентификация, часть 3 — ручная проверка оператора платформы

Новых автотестов нет: тесты отложены до готовности MVP, непокрытое перечислено в разделе
«Долг по тестам» файла `2026-10-05-auth-part3.md`. Этот сценарий проверяет вручную основной путь и
пункты Review Focus 1–5.

Все команды — bash (Git Bash), запускаются из корня репозитория. Данные только синтетические
(домен `pharmacy.test`).

## Подготовка

1. Поднять зависимости и применить миграции: `npm run dev:deps`, `npx nx run api:migrate`.
2. Собрать API и запустить его с тестовыми cookie. Тестовые cookie `op_sid`/`sid` идут без `Secure`,
   иначе curl не отправит их по http:

   ```bash
   npx nx build api
   APP_ENV=test AUTH_TEST_COOKIES=true node --env-file=.env apps/api/dist/main.js
   ```

   В панели браузера это конфигурация `api-test-cookies` из `.claude/launch.json`.
3. Во втором терминале задать переменные:

   ```bash
   API=http://127.0.0.1:3000/api/v1
   H=(-H "Origin: http://localhost:4300" -H "Content-Type: application/json")
   L=operator-1@pharmacy.test
   P='Operator-Passw0rd-2026'
   ```

## Основной путь

```bash
node --env-file=.env apps/api/scripts/create-operator.mjs --login "$L" --name "Тест Оператор"
# → «Operator created.», код (печатается один раз) и срок действия

curl -s -X POST $API/operator/activations "${H[@]}" -d '{"login":"'$L'","code":"<код>","newPassword":"'$P'"}' -w '%{http_code}\n'      # → 204
curl -s -X POST $API/operator/activations "${H[@]}" -d '{"login":"'$L'","code":"<код>","newPassword":"'$P'"}'                          # → 401 invalid_code

curl -s -c op.txt -b op.txt -X POST $API/operator/sessions "${H[@]}" -d '{"login":"'$L'","password":"'$P'"}'   # → 201 OperatorSession
curl -s -b op.txt $API/operator/sessions/current                                                                # → 200
curl -s -b op.txt -c op.txt -X DELETE $API/operator/sessions/current -H "Origin: http://localhost:4300" -w '%{http_code}\n'   # → 204
curl -s -b op.txt $API/operator/sessions/current -w '\n%{http_code}\n'                                          # → 401
```

## Review Focus

1. **Чужой контур.** Сначала снова войти и получить `op.txt`.
   - `curl -s -b op.txt $API/me` → `401`.
   - `curl -s -H "Cookie: sid=<значение op_sid>" $API/me` → `401`: JWT оператора с `aud=admin` не
     принимается как токен сотрудника.
   - Наоборот: cookie сотрудника `sid` (вход `POST /sessions`) на `/operator/sessions/current` → `401`.
2. **Запрет по умолчанию.** Маршрутов оператора без `@RequireOperatorPermission` пока нет. Проверяется
   ревью кода (`OperatorPermissionsGuard`) и первым модулем админки. Запрос на несуществующий
   `/operator/x` → `404`.
3. **Перебор при входе.**
   - Неизвестный e-mail, неверный пароль и заблокированный оператор → одинаковый
     `401 invalid_credentials`, время ответа ≈ `LOGIN_FAILURE_FLOOR_MS` (0,4–0,5 с).
   - 5 неудач подряд для одного e-mail → `429 login_locked`.
   - Логин не в формате e-mail → `401` без расхода лимита.
4. **CSRF админки.**
   - `POST $API/operator/sessions` с `Origin: http://localhost:4200` → `403 csrf_rejected`.
   - `POST $API/sessions` с `Origin: http://localhost:4300` → тоже `403`.
5. **Блокировка оператора.**
   - При открытой сессии выполнить в БД (роль `pharmacy_platform`, `app.actor = 'system:…'`):
     `update pharmacy.operators set status = 'blocked' where lower(login) = '<L>'`.
   - Следующий `GET /operator/sessions/current` → `401`, вход → `401`.
   - Повторный `create-operator.mjs` для заблокированного оператора → «The operator is blocked.».

**Журнал.** В `platform_audit_log` есть события:
- `operator.code-issued` — actor `system`, job `create-operator`;
- `operator.activated`;
- `auth.operator-login-succeeded` / `auth.operator-login-failed` — с причиной, без логина и пароля.

После проверки: `rm op.txt`.
