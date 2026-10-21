-- Up Migration
-- The journal of the loads of data from a file (spec 2026-10-20-data-import, F15, F16; data model 06, amendment
-- 2026-10-20). Class `tenant`, rows are only inserted:
--   import_jobs - one row per load that was written (a refused load leaves nothing: the check is synchronous). The
--                 file itself is not stored: its name, the SHA-256 of the rows, the answer of the load. The answer is
--                 returned again to a repeat with the same Idempotency-Key; the same rows loaded again are allowed,
--                 the check warns about them (F13) — so the hash is not unique.
create table pharmacy.import_jobs (
  tenant_id uuid not null references pharmacy.tenants (id),
  id uuid not null,
  kind text not null check (kind in ('catalog', 'opening_balance', 'suppliers')),
  store_id uuid,
  file_name text not null check (char_length(file_name) between 1 and 255),
  content_sha256 bytea not null check (octet_length(content_sha256) = 32),
  idempotency_key uuid not null,
  result jsonb not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, idempotency_key),
  check ((kind = 'opening_balance') = (store_id is not null)),
  foreign key (tenant_id, store_id) references pharmacy.stores (tenant_id, id),
  foreign key (tenant_id, created_by) references pharmacy.employees (tenant_id, id)
);
create index import_jobs_content_idx on pharmacy.import_jobs (tenant_id, kind, store_id, content_sha256);

-- Isolation and grants (ADR-0013): fail-closed tenant filter for pharmacy_app; no UPDATE or DELETE — the journal
-- only grows.
alter table pharmacy.import_jobs enable row level security;
alter table pharmacy.import_jobs force row level security;
create policy tenant_isolation on pharmacy.import_jobs for all to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));
grant select, insert on pharmacy.import_jobs to pharmacy_app;

-- Append-only as the other journals (table-classes.ts, APPEND_ONLY_TABLES): even the owner cannot change a row.
create trigger import_jobs_no_update_delete
  before update or delete on pharmacy.import_jobs
  for each row execute function pharmacy.forbid_mutation();
create trigger import_jobs_no_truncate
  before truncate on pharmacy.import_jobs
  for each statement execute function pharmacy.forbid_mutation();
