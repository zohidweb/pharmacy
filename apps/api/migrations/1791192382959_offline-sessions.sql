-- Up Migration
-- Auth part 4: server sessions of an offline store (auth design 2026-10-02, section 10). The cloud
-- keeps sessions in Redis and never writes this table; an offline store has no Redis. Class tenant:
-- read and written only through TenantDatabase under RLS. No secrets: ids, the permissions
-- snapshot and the SHA-256 of a terminal's device secret.
create table pharmacy.sessions (
  tenant_id uuid not null references pharmacy.tenants (id),
  jti uuid not null,
  employee_id uuid not null,
  auth_method text not null check (auth_method in ('password', 'pin')),
  authenticated_at timestamptz not null,
  permissions text[] not null default '{}',
  permissions_version bigint not null check (permissions_version >= 0),
  store_scope jsonb not null check (
    store_scope = '"all"'::jsonb or jsonb_typeof(store_scope) = 'array'
  ),
  current_store_id uuid,
  terminal_id uuid,
  terminal_credential_hash text,
  locale text not null check (locale in ('ru', 'tg')),
  idle_ttl_seconds integer not null check (idle_ttl_seconds > 0),
  idle_expires_at timestamptz not null,
  absolute_expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, jti),
  foreign key (tenant_id, employee_id) references pharmacy.employees (tenant_id, id),
  foreign key (tenant_id, terminal_id) references pharmacy.terminals (tenant_id, id),
  -- A PIN session belongs to a terminal and carries its device hash; a password session neither.
  check ((terminal_id is null) = (terminal_credential_hash is null)),
  check ((auth_method = 'pin') = (terminal_id is not null)),
  check (idle_expires_at <= absolute_expires_at)
);
create index sessions_employee_idx on pharmacy.sessions (tenant_id, employee_id);
create index sessions_terminal_idx on pharmacy.sessions (tenant_id, terminal_id);
create index sessions_expires_idx on pharmacy.sessions (tenant_id, absolute_expires_at);

alter table pharmacy.sessions enable row level security;
alter table pharmacy.sessions force row level security;
create policy tenant_isolation on pharmacy.sessions for all to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));
grant select, insert, update, delete on pharmacy.sessions to pharmacy_app;
