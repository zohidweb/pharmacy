-- Up Migration
-- Auth part 3: platform operators, their credentials and the append-only platform audit log
-- (data model 01 and 06; ADR-0013; auth design 2026-10-02, section 9). Class platform: only the
-- platform path (pharmacy_platform) reaches them; pharmacy_app has no privileges at all.

-- operators - platform staff. login is the work e-mail, unique case-insensitively.
create table pharmacy.operators (
  id uuid primary key,
  login text not null,
  full_name text not null check (length(trim(full_name)) > 0),
  status text not null default 'active' check (status in ('active', 'blocked')),
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index operators_login_uq on pharmacy.operators (lower(login));

-- operator_credentials - the password hash (PHC) with its pepper version and a one-time
-- activation code (SHA-256 only), the same rules as employee_credentials.
create table pharmacy.operator_credentials (
  operator_id uuid primary key references pharmacy.operators (id),
  password_hash text,
  password_pepper_version integer check (password_pepper_version >= 1),
  password_changed_at timestamptz,
  one_time_code_hash text,
  one_time_code_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((password_hash is null) = (password_pepper_version is null)),
  check ((one_time_code_hash is null) = (one_time_code_expires_at is null))
);

-- platform_audit_log - what operators and platform jobs did (data model 06). Append-only like
-- audit_log; not partitioned (low volume). operator_id is not a foreign key: the actor of a row
-- written in the same transaction as the operator's creation must not depend on the order.
create table pharmacy.platform_audit_log (
  id uuid primary key,
  recorded_at timestamptz not null default now(),
  actor_kind text not null check (actor_kind in ('operator', 'system')),
  operator_id uuid,
  job text,
  action text not null,
  tenant_id uuid,
  entity_type text,
  entity_id uuid,
  details jsonb not null default '{}' check (jsonb_typeof(details) = 'object'),
  correlation_id uuid not null,
  check ((actor_kind = 'operator') = (operator_id is not null)),
  check ((actor_kind = 'system') = (job is not null))
);
create index platform_audit_log_recorded_idx on pharmacy.platform_audit_log (recorded_at);
create index platform_audit_log_operator_idx on pharmacy.platform_audit_log (operator_id, recorded_at);

create trigger platform_audit_log_no_update_delete
  before update or delete on pharmacy.platform_audit_log
  for each row execute function pharmacy.forbid_mutation();
create trigger platform_audit_log_no_truncate
  before truncate on pharmacy.platform_audit_log
  for each statement execute function pharmacy.forbid_mutation();

-- Row level security: enabled and forced; the platform path sees every row.
alter table pharmacy.operators enable row level security;
alter table pharmacy.operators force row level security;
alter table pharmacy.operator_credentials enable row level security;
alter table pharmacy.operator_credentials force row level security;
alter table pharmacy.platform_audit_log enable row level security;
alter table pharmacy.platform_audit_log force row level security;

create policy platform_all on pharmacy.operators for all to pharmacy_platform
  using (true) with check (true);
create policy platform_all on pharmacy.operator_credentials for all to pharmacy_platform
  using (true) with check (true);
create policy platform_all on pharmacy.platform_audit_log for all to pharmacy_platform
  using (true) with check (true);

grant select, insert, update on pharmacy.operators to pharmacy_platform;
grant select, insert, update on pharmacy.operator_credentials to pharmacy_platform;
grant select, insert on pharmacy.platform_audit_log to pharmacy_platform;
