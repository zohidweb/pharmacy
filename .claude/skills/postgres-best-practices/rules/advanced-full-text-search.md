---
title: Search the Drug Catalog in RU/TJ with tsvector and pg_trgm
impact: MEDIUM
impactDescription: Sub-100 ms catalog search at the POS by name, INN, typo or partial barcode
tags: full-text-search, tsvector, pg_trgm, gin, search, russian, tajik, barcode
---

## Search the Drug Catalog in RU/TJ with tsvector and pg_trgm

Касса ищет товар по штрихкоду (сканер USB HID — точное совпадение), по названию RU/TJ, по МНН
(поиск аналогов) и с опечатками. `LIKE '%…%'` без индекса сканирует весь каталог. Комбинация:

| Задача | Механизм | Индекс |
|---|---|---|
| Скан штрихкода | точное равенство | B-tree `(tenant_id, barcode)` |
| Ручной ввод части штрихкода | `LIKE '460123%'` / `'%0123%'` | B-tree `text_pattern_ops` / GIN `gin_trgm_ops` |
| Название RU (морфология: «таблетки» ~ «таблетка») | `tsvector` с конфигурацией `russian` | GIN |
| Название TJ, МНН, латиница | `tsvector` с конфигурацией `simple` (стеммера для таджикского в PostgreSQL нет) | GIN |
| Опечатки, частичные слова («парацетм») | `pg_trgm`: `%`, `similarity()`, `ILIKE` | GIN/GiST `gin_trgm_ops` |

**Incorrect:**

```sql
select * from products where name_ru like '%парацетамол%' or name_tj like '%парацетамол%';
-- Seq Scan; no morphology, no typos
select * from products where to_tsvector('english', name_ru) @@ to_tsquery('english', 'таблетки');
-- wrong config for Cyrillic
```

**Correct:**

```sql
create extension if not exists pg_trgm;

alter table products add column search_vector tsvector generated always as (
  setweight(to_tsvector('russian', translate(lower(coalesce(name_ru, '')), 'ё', 'е')), 'A') ||
  setweight(to_tsvector('simple',  lower(coalesce(name_tj, ''))), 'A') ||
  setweight(to_tsvector('simple',  lower(coalesce(inn, ''))), 'B')
) stored;

create index products_search_idx   on products using gin (search_vector);
create index products_name_ru_trgm on products using gin (lower(name_ru) gin_trgm_ops);
create index products_name_tj_trgm on products using gin (lower(name_tj) gin_trgm_ops);

-- 1. Barcode scan: exact match first (PK (tenant_id, barcode), see query-covering-indexes.md)
select product_id from product_barcodes where tenant_id = $1 and barcode = $2;

-- 2. Text search: full-text by words ($2 = raw user input)
select p.id, p.name_ru, p.name_tj,
       ts_rank(p.search_vector, s.q) as rank
from products p
cross join (
  select websearch_to_tsquery('russian', translate(lower($2), 'ё', 'е'))
      || websearch_to_tsquery('simple', lower($2)) as q      -- OR of both configs
) s
where p.tenant_id = $1 and p.archived_at is null
  and p.search_vector @@ s.q
order by rank desc
limit 20;

-- 3. Fallback for typos / partial words when step 2 returned nothing
select p.id, p.name_ru, p.name_tj,
       greatest(similarity(lower(p.name_ru), lower($2)),
                similarity(lower(coalesce(p.name_tj, '')), lower($2))) as score
from products p
where p.tenant_id = $1 and p.archived_at is null
  and (lower(p.name_ru) % lower($2) or lower(p.name_tj) % lower($2))
order by score desc
limit 20;

-- Partial barcode typed by hand (prefix): B-tree with text_pattern_ops
create index product_barcodes_prefix_idx on product_barcodes (tenant_id, barcode text_pattern_ops);
-- ($2 must have LIKE wildcards % and _ escaped by the app)
select product_id from product_barcodes where tenant_id = $1 and barcode like $2 || '%';
```

Нюансы Pharmacy:

- **Локаль БД**: `pg_trgm` и парсер full-text классифицируют буквы по `LC_CTYPE`. В локали `C`
  кириллица (включая таджикские ғ, ӣ, қ, ӯ, ҳ, ҷ) может не считаться буквами — триграммы пустые.
  БД создаётся в `UTF8` с `LC_CTYPE` на базе UTF-8 (например, `ru_RU.UTF-8`/`en_US.UTF-8`),
  **одинаково** в облаке и в образе офлайн-точки. Проверка: `select show_trgm('қатор');`.
- **Расширения** (`pg_trgm`, при необходимости `btree_gin`, `unaccent`) должны быть доступны и в
  облачной PostgreSQL, и в Docker-образе офлайн-точки; `create extension` — в миграциях под ролью
  владельца. Нестандартные расширения/словари (например, hunspell-словарь TJ) не входят в
  стандартную поставку — их включение в образ согласуется отдельно.
- `tenant_id` не входит в GIN-индекс: при каталоге в десятки тысяч позиций на тенанта фильтр
  после GIN-скана достаточен. Если замеры покажут иное — `btree_gin` и составной
  GIN `(tenant_id, search_vector)`.
- Порог похожести `pg_trgm.similarity_threshold` (по умолчанию 0.3) подбирается на реальных
  названиях; `set local` в транзакции поиска, не глобально.
- Поиск аналогов — по полю `inn` (равенство/триграммы), а не по названию.

Reference: [Full Text Search](https://www.postgresql.org/docs/current/textsearch.html),
[pg_trgm](https://www.postgresql.org/docs/current/pgtrgm.html)
