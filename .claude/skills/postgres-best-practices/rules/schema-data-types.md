---
title: Choose Appropriate Data Types
impact: HIGH
impactDescription: Prevents precision, timezone and leading-zero bugs; smaller, faster indexes
tags: data-types, schema, storage, performance
---

## Choose Appropriate Data Types

Using the right data types reduces storage, improves query performance, and prevents bugs.

**Incorrect (wrong data types):**

```sql
create table products (
  id int,                        -- overflows; also collides between offline stores
  barcode bigint,                -- loses leading zeros, breaks non-numeric codes
  name_ru varchar(255),          -- arbitrary limit
  created_at timestamp,          -- no timezone
  is_prescription varchar(5),    -- string for boolean
  retail_price numeric(10,2)     -- fractional money (see schema-money-integer.md)
);
```

**Correct (appropriate data types):**

```sql
create table products (
  id uuid primary key,                           -- see schema-primary-keys.md
  tenant_id uuid not null,
  name_ru text not null,
  name_tj text,
  inn text,                                      -- международное непатентованное наименование
  is_prescription boolean not null default false,
  is_controlled boolean not null default false,  -- ПКУ
  units_per_pack integer not null default 1 check (units_per_pack > 0),
  created_at timestamptz not null default now()
);

create table product_barcodes (
  tenant_id uuid not null,
  product_id uuid not null,
  barcode text not null check (barcode ~ '^[0-9A-Za-z-]{4,64}$'),
  primary key (tenant_id, barcode)
);

create table batches (
  -- ...
  expires_on date not null,                      -- expiry is a calendar date, not a timestamp
  pack_cost_dirams bigint not null check (pack_cost_dirams >= 0)
);
```

Key guidelines:

```sql
-- IDs: uuid (v7) for entities that may be created on offline stores, see schema-primary-keys.md
-- Strings: text (+ check constraint if a limit is a business rule)
-- Codes/barcodes: text, never numeric types
-- Time: timestamptz for events, date for expiry dates and business days
-- Money: bigint in dirams, never float/money/numeric(…,2)
-- Quantities: integer in minimal sale units (packs split into units)
-- Statuses: text + check constraint (easier to migrate than enum types)
```

Reference: [Data Types](https://www.postgresql.org/docs/current/datatype.html)
