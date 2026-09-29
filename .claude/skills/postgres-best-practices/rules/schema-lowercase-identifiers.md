---
title: Use Lowercase snake_case Identifiers in the Database
impact: MEDIUM
impactDescription: Avoid case-sensitivity bugs with tools, ORMs, and AI assistants
tags: naming, identifiers, case-sensitivity, schema, conventions
---

## Use Lowercase snake_case Identifiers in the Database

PostgreSQL folds unquoted identifiers to lowercase. Quoted mixed-case identifiers require quotes
forever and cause issues with tools, ORMs, and AI assistants.

В Pharmacy: в БД — `snake_case` (`tenant_id`, `unit_price_dirams`), в REST JSON — `camelCase`
(`tenantId`, `unitPriceDirams`). Преобразование делает слой доступа к данным / маппинг DTO, а не
кавычки в схеме. Имена сущностей — из `docs/architecture/glossary.md`, во множественном числе для
таблиц: `tenants`, `stores`, `products`, `batches`, `stock_movements`, `documents`, `receipts`,
`shifts`, `payments`, `suppliers`, `audit_log`.

**Incorrect (mixed-case identifiers):**

```sql
-- Typical output of an ORM left with defaults: quoted camelCase / PascalCase
CREATE TABLE "Receipt" (
  "id" uuid PRIMARY KEY,
  "tenantId" uuid NOT NULL,
  "totalDirams" bigint NOT NULL
);

SELECT "totalDirams" FROM "Receipt" WHERE "tenantId" = $1;  -- quotes forever
SELECT totalDirams FROM Receipt;  -- ERROR: relation "receipt" does not exist
```

**Correct (lowercase snake_case):**

```sql
create table receipts (
  id uuid primary key,
  tenant_id uuid not null,
  total_dirams bigint not null
);

select total_dirams from receipts where tenant_id = $1;
```

ORM не выбран (**требует ADR через `/03-adr`**). При выборе — проверить, что он умеет маппить
`snake_case` колонки на `camelCase` поля без кавычек в DDL; это критерий выбора, а не повод
менять конвенцию БД.

Reference: [Identifiers and Key Words](https://www.postgresql.org/docs/current/sql-syntax-lexical.html#SQL-SYNTAX-IDENTIFIERS)
