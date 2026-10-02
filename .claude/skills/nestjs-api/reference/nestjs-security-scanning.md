# NestJS Security — проверки зависимостей, ESLint, grep-аудит, CORS

CI — GitHub Actions (ADR-0009): гейт `checks` на PR, ночью — `npm audit` и Trivy, Dependabot.
Пока workflow-файлов нет, всё запускается локально перед PR (`npm run check`). Внешние
SaaS-сканеры, которым уходит состав зависимостей или код (Snyk и т.п.), не используем без ADR.
Валидация и маскирование ПДн — `nestjs-security-validation-logging.md`; аутентификация —
`nestjs-security-auth.md`.

## 1. Зависимости

```bash
npm ci                                   # strictly by lock file
npm audit --omit=dev --audit-level=high  # production deps: fix or document before MR
npm audit                                # full picture incl. dev tooling
```

- `npm audit fix --force` не запускать вслепую: мажорные апдейты NestJS/Nx — отдельной задачей.
- Новая зависимость: лицензия, реестр (только публичный npm-реестр), активность поддержки;
  технология вне стека → ADR команды (`/03-adr`).

## 2. ESLint security (Nx flat config)

```bash
npm install -D eslint-plugin-security
```

```javascript
// apps/api/eslint.config.mjs
import baseConfig from '../../eslint.config.mjs';
import security from 'eslint-plugin-security';

export default [
  ...baseConfig,
  security.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': 'error',                              // use Nest Logger
      'no-eval': 'error',
      'no-new-func': 'error',
      'security/detect-object-injection': 'off',          // too noisy for typed TS maps; review manually
    },
  },
];
```

```bash
npx nx lint api
npx nx affected -t lint
```

Правило границ `@nx/enforce-module-boundaries` (корневой конфиг) — тоже часть безопасности:
apps не импортируют друг друга, `libs/shared/dto` не тянет серверный код во фронтенды.

## 3. Grep-аудит перед MR

```bash
# Secrets and connection strings in code
grep -rnE "(password|secret|apiKey|token|licenseKey)\s*[:=]\s*['\"][^'\"]+['\"]" apps/api/src libs
grep -rn "postgres://\|postgresql://\|redis://" apps/api/src libs

# SQL built by concatenation / template interpolation (must be $1 parameters)
grep -rn 'query[^(]*(\s*`[^`]*\${' apps/api/src

# Queries without tenant filter (review every hit on tenant tables)
grep -rnE "FROM [a-z_]+" apps/api/src/modules | grep -v "tenant_id"

# Money as float
grep -rnE "parseFloat|toFixed|Number\(.*(price|amount|sum|total)" apps/api/src libs/shared

# Mutations of append-only tables
grep -rniE "(UPDATE|DELETE FROM)\s+(audit_log|stock_movements|controlled_substance_journal)" apps/api/src

# Schema auto-sync, console, forbidden tech
grep -rnE "synchronize:\s*true|db push" apps/api libs
grep -rn "console\." apps/api/src
grep -rnE "from '(bullmq|amqplib|kafkajs|@opentelemetry|pino|winston|@nestjs/platform-fastify|jsonwebtoken|@nestjs/jwt|passport)" apps/api/src
```

Каждое срабатывание — либо исправить, либо объяснить в MR. Grep — вспомогательная проверка,
не замена ревью (`nestjs-review-checklist.md`).

## 4. CORS

```typescript
app.enableCors({
  origin: secCfg.corsOrigins,   // explicit list: web and admin origins of this environment
  credentials: true,            // required for cookie sessions (if ADR chooses cookies)
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'X-Correlation-Id', 'Idempotency-Key'],
  exposedHeaders: ['X-Correlation-Id'],
  maxAge: 600,
});
```

- `origin: '*'` вместе с `credentials: true` — запрещено (и не работает в браузерах).
- Если web/admin и api отдаются с одного origin, CORS не нужен вовсе — не включайте «на всякий случай».
- Заголовки безопасности (helmet) — `nestjs-enterprise-infrastructure.md`.
