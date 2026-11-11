-- The platform drug reference (ADR-0013, decision 2 of 2026-09-30; data model 02, decision D4): written by the
-- platform operator (pharmacy_platform: the seed script now, an admin screen later), read by every network as a
-- template for its own product cards. Plan 2026-11-11-drug-reference-seed, R8. A product card does not link to the
-- reference yet: it is a copy (D4); the link comes with «the reference has an update».

create table pharmacy.drug_reference (
  id uuid primary key,
  name jsonb not null check (
    jsonb_typeof(name) = 'object' and jsonb_typeof(name -> 'ru') = 'string' and name ->> 'ru' <> ''
  ),
  inn jsonb check (inn is null or (jsonb_typeof(inn) = 'object' and inn <> '{}'::jsonb)),
  dosage_form text check (dosage_form is null or char_length(dosage_form) between 1 and 200),
  dosage text check (dosage is null or char_length(dosage) between 1 and 200),
  manufacturer text check (manufacturer is null or char_length(manufacturer) between 1 and 200),
  country text check (country ~ '^[A-Z]{2}$'),
  is_prescription boolean not null default false,
  is_controlled boolean not null default false,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not is_controlled or is_prescription)
);
-- search by a part of the name: case-insensitive, `ё` as `е` (the query is normalized the same way)
create index drug_reference_name_ru_trgm on pharmacy.drug_reference
  using gin (replace(lower(name ->> 'ru'), 'ё', 'е') pharmacy.gin_trgm_ops);
create index drug_reference_name_tj_trgm on pharmacy.drug_reference
  using gin (replace(lower(name ->> 'tj'), 'ё', 'е') pharmacy.gin_trgm_ops);

-- A barcode (GTIN) belongs to one entry of the reference.
create table pharmacy.drug_reference_barcodes (
  barcode text primary key check (barcode ~ '^[0-9]{8,14}$'),
  drug_reference_id uuid not null references pharmacy.drug_reference (id)
);
create index drug_reference_barcodes_entry_idx on pharmacy.drug_reference_barcodes (drug_reference_id);

alter table pharmacy.drug_reference enable row level security;
alter table pharmacy.drug_reference force row level security;
alter table pharmacy.drug_reference_barcodes enable row level security;
alter table pharmacy.drug_reference_barcodes force row level security;

create policy platform_all on pharmacy.drug_reference for all to pharmacy_platform
  using (true) with check (true);
create policy platform_all on pharmacy.drug_reference_barcodes for all to pharmacy_platform
  using (true) with check (true);
-- every network reads the whole reference (class shared)
create policy tenant_read on pharmacy.drug_reference for select to pharmacy_app
  using (true);
create policy tenant_read on pharmacy.drug_reference_barcodes for select to pharmacy_app
  using (true);

grant select, insert, update on pharmacy.drug_reference to pharmacy_platform;
grant select, insert, update on pharmacy.drug_reference_barcodes to pharmacy_platform;
grant select on pharmacy.drug_reference to pharmacy_app;
grant select on pharmacy.drug_reference_barcodes to pharmacy_app;
