-- Up Migration
-- Auth part 1: global login identifiers, the pre-context resolver resolve_login and the
-- append-only audit_log (data model 01 and 06, amendments 2026-10-02; ADR-0008 and ADR-0013,
-- amendments 2026-10-02). Expand-only: new nullable columns, a new table and a new function.

-- Login identifiers. login, phone (E.164) and email are unique across the whole platform, so an
-- identifier resolves to exactly one tenant before the tenant context exists. Callers pass
-- normalized values: lower() of login and email, phone in E.164.
alter table pharmacy.employees
  add column email text,
  add column last_login_at timestamptz,
  add constraint employees_phone_e164_check check (phone ~ '^\+[1-9][0-9]{7,14}$');

drop index pharmacy.employees_login_uq;
create unique index employees_login_global_uq on pharmacy.employees (lower(login));
create unique index employees_phone_global_uq on pharmacy.employees (phone);
create unique index employees_email_global_uq on pharmacy.employees (lower(email));

-- Role template the role was created from (RoleTemplateKey in libs/shared/domain); null for own roles.
alter table pharmacy.roles
  add column template_key text check (template_key in ('owner', 'manager', 'cashier', 'accountant'));

-- resolve_login - pre-context resolver (ADR-0013 p. 3, amendment 2026-10-02). Exact match on a
-- globally unique indexed expression, one branch per kind; an unknown kind returns no rows.
-- Returns ids and the tenant status only. All column references are qualified because the
-- output columns are plpgsql variables of the same names.
create function pharmacy.resolve_login(p_kind text, p_value text)
returns table (tenant_id uuid, employee_id uuid, tenant_status text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_kind = 'login' then
    return query
      select e.tenant_id, e.id, t.status
      from pharmacy.employees e
      join pharmacy.tenants t on t.id = e.tenant_id
      where lower(e.login) = p_value;
  elsif p_kind = 'phone' then
    return query
      select e.tenant_id, e.id, t.status
      from pharmacy.employees e
      join pharmacy.tenants t on t.id = e.tenant_id
      where e.phone = p_value;
  elsif p_kind = 'email' then
    return query
      select e.tenant_id, e.id, t.status
      from pharmacy.employees e
      join pharmacy.tenants t on t.id = e.tenant_id
      where lower(e.email) = p_value;
  end if;
end;
$$;
alter function pharmacy.resolve_login(text, text) owner to pharmacy_resolver;
revoke all on function pharmacy.resolve_login(text, text) from public;
grant execute on function pharmacy.resolve_login(text, text) to pharmacy_app;

-- The resolver reads only the columns it needs; FORCE RLS applies to it, hence the policies.
create policy resolver_read on pharmacy.employees for select to pharmacy_resolver using (true);
grant select (tenant_id, id, login, phone, email) on pharmacy.employees to pharmacy_resolver;
create policy resolver_read on pharmacy.tenants for select to pharmacy_resolver using (true);
grant select (id, status) on pharmacy.tenants to pharmacy_resolver;

-- audit_log - tenant audit (class tenant, data model 06), append-only, monthly partitions by
-- recorded_at. The partition key is part of the primary key. Only tenant_id is a foreign key:
-- employee, store and terminal ids are written by the application in the same transaction.
create table pharmacy.audit_log (
  tenant_id uuid not null references pharmacy.tenants (id),
  id uuid not null,
  recorded_at timestamptz not null default now(),
  business_date date not null,
  employee_id uuid,
  store_id uuid,
  terminal_id uuid,
  acting_operator_id uuid,
  impersonation_id uuid,
  correlation_id text not null,
  action text not null,
  entity_type text,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  source text not null check (source in ('cloud', 'offline_store')),
  primary key (tenant_id, id, recorded_at)
) partition by range (recorded_at);

-- Filters of the audit screen (BL W1-16).
create index audit_log_recorded_idx on pharmacy.audit_log (tenant_id, recorded_at);
create index audit_log_employee_idx on pharmacy.audit_log (tenant_id, employee_id, recorded_at);
create index audit_log_store_idx on pharmacy.audit_log (tenant_id, store_id, recorded_at);

-- Monthly partitions (UTC boundaries) up to 2027-12. No DEFAULT partition: an insert outside
-- them fails loudly. Later partitions are created ahead by a scheduled job (auth part 1
-- follow-ups). Partitions get no grants: access goes through the parent only.
create table pharmacy.audit_log_2026_10 partition of pharmacy.audit_log
  for values from ('2026-10-01 00:00:00+00') to ('2026-11-01 00:00:00+00');
create table pharmacy.audit_log_2026_11 partition of pharmacy.audit_log
  for values from ('2026-11-01 00:00:00+00') to ('2026-12-01 00:00:00+00');
create table pharmacy.audit_log_2026_12 partition of pharmacy.audit_log
  for values from ('2026-12-01 00:00:00+00') to ('2027-01-01 00:00:00+00');
create table pharmacy.audit_log_2027_01 partition of pharmacy.audit_log
  for values from ('2027-01-01 00:00:00+00') to ('2027-02-01 00:00:00+00');
create table pharmacy.audit_log_2027_02 partition of pharmacy.audit_log
  for values from ('2027-02-01 00:00:00+00') to ('2027-03-01 00:00:00+00');
create table pharmacy.audit_log_2027_03 partition of pharmacy.audit_log
  for values from ('2027-03-01 00:00:00+00') to ('2027-04-01 00:00:00+00');
create table pharmacy.audit_log_2027_04 partition of pharmacy.audit_log
  for values from ('2027-04-01 00:00:00+00') to ('2027-05-01 00:00:00+00');
create table pharmacy.audit_log_2027_05 partition of pharmacy.audit_log
  for values from ('2027-05-01 00:00:00+00') to ('2027-06-01 00:00:00+00');
create table pharmacy.audit_log_2027_06 partition of pharmacy.audit_log
  for values from ('2027-06-01 00:00:00+00') to ('2027-07-01 00:00:00+00');
create table pharmacy.audit_log_2027_07 partition of pharmacy.audit_log
  for values from ('2027-07-01 00:00:00+00') to ('2027-08-01 00:00:00+00');
create table pharmacy.audit_log_2027_08 partition of pharmacy.audit_log
  for values from ('2027-08-01 00:00:00+00') to ('2027-09-01 00:00:00+00');
create table pharmacy.audit_log_2027_09 partition of pharmacy.audit_log
  for values from ('2027-09-01 00:00:00+00') to ('2027-10-01 00:00:00+00');
create table pharmacy.audit_log_2027_10 partition of pharmacy.audit_log
  for values from ('2027-10-01 00:00:00+00') to ('2027-11-01 00:00:00+00');
create table pharmacy.audit_log_2027_11 partition of pharmacy.audit_log
  for values from ('2027-11-01 00:00:00+00') to ('2027-12-01 00:00:00+00');
create table pharmacy.audit_log_2027_12 partition of pharmacy.audit_log
  for values from ('2027-12-01 00:00:00+00') to ('2028-01-01 00:00:00+00');

-- Append-only: no UPDATE/DELETE/TRUNCATE grants, and a trigger rejects them for any role that
-- reaches the rows. Row triggers on a partitioned table are cloned to every partition.
create function pharmacy.forbid_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'pharmacy.% is append-only: % is not allowed', tg_table_name, tg_op
    using errcode = '42501';  -- insufficient_privilege
end;
$$;

create trigger audit_log_no_update_delete
  before update or delete on pharmacy.audit_log
  for each row execute function pharmacy.forbid_mutation();
create trigger audit_log_no_truncate
  before truncate on pharmacy.audit_log
  for each statement execute function pharmacy.forbid_mutation();

-- Fail-closed tenant filter for pharmacy_app (same contract as the other tenant tables); with
-- only SELECT and INSERT granted, the policy admits reads and inserts of the own tenant.
alter table pharmacy.audit_log enable row level security;
alter table pharmacy.audit_log force row level security;
create policy tenant_isolation on pharmacy.audit_log for all to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));
grant select, insert on pharmacy.audit_log to pharmacy_app;
