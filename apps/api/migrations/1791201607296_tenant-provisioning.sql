-- Up Migration
-- Tenants module (spec 2026-10-05-tenants-module-design; ADR-0013, amendment 2026-10-05): the
-- operator creates a network with its owner and issues the owner's one-time activation code through
-- two SECURITY DEFINER functions owned by pharmacy_provisioner, and blocks a network in its own
-- platform row. The platform path still has no privileges on tenant tables.

-- tenants: the city, the owner's contact for the platform (written at provisioning, not read from
-- employees) and the operator's block. INN stays in billing_tax_id.
alter table pharmacy.tenants
  add column city text not null default '',
  add column owner_full_name text,
  add column owner_login text,
  add column owner_phone text,
  add column owner_email text,
  add column blocked_at timestamptz,
  add column blocked_by uuid,
  add column block_reason text,
  add constraint tenants_block_check check (
    (status = 'blocked') = (blocked_at is not null)
    and (blocked_at is null) = (blocked_by is null)
    and (blocked_at is null) = (block_reason is null)
  );

-- pharmacy_provisioner writes only through the functions below (it has no login). Privileges are
-- the minimum the function bodies need; RLS is forced on every table, hence the policies.
grant select (id, status), insert on pharmacy.tenants to pharmacy_provisioner;
grant insert on pharmacy.tenant_settings to pharmacy_provisioner;
grant select (tenant_id, id, is_owner), insert on pharmacy.roles to pharmacy_provisioner;
grant select (tenant_id, id, role_id, status), insert on pharmacy.employees to pharmacy_provisioner;
grant select (tenant_id, employee_id), insert,
  update (one_time_code_hash, one_time_code_expires_at, updated_at)
  on pharmacy.employee_credentials to pharmacy_provisioner;

create policy provisioner_all on pharmacy.tenants for all to pharmacy_provisioner
  using (true) with check (true);
create policy provisioner_all on pharmacy.tenant_settings for all to pharmacy_provisioner
  using (true) with check (true);
create policy provisioner_all on pharmacy.roles for all to pharmacy_provisioner
  using (true) with check (true);
create policy provisioner_all on pharmacy.employees for all to pharmacy_provisioner
  using (true) with check (true);
create policy provisioner_all on pharmacy.employee_credentials for all to pharmacy_provisioner
  using (true) with check (true);

-- provision_tenant - a brand-new network in one call: the tenant row (with the owner's contact),
-- default settings, the owner role from the template, the owner (store scope all) and the hash of
-- the owner's activation code. Ids come from the application (no id defaults). An existing tenant
-- id fails on the primary key, so an existing network is never changed; a taken login, phone or
-- e-mail fails on the global unique indexes. Logins and e-mails are stored lower-cased.
create function pharmacy.provision_tenant(
  p_tenant_id uuid,
  p_code text,
  p_name text,
  p_city text,
  p_inn text,
  p_owner_employee_id uuid,
  p_owner_role_id uuid,
  p_owner_role_name jsonb,
  p_owner_full_name text,
  p_owner_login text,
  p_owner_phone text,
  p_owner_email text,
  p_code_hash text,
  p_code_expires_at timestamptz
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into pharmacy.tenants
    (id, code, name, city, billing_tax_id, owner_full_name, owner_login, owner_phone, owner_email)
  values
    (p_tenant_id, p_code, p_name, p_city, p_inn, p_owner_full_name, lower(p_owner_login),
     p_owner_phone, lower(p_owner_email));

  insert into pharmacy.tenant_settings (tenant_id) values (p_tenant_id);

  insert into pharmacy.roles (tenant_id, id, name, is_owner, template_key)
  values (p_tenant_id, p_owner_role_id, p_owner_role_name, true, 'owner');

  insert into pharmacy.employees
    (tenant_id, id, role_id, login, full_name, phone, email, store_scope)
  values
    (p_tenant_id, p_owner_employee_id, p_owner_role_id, lower(p_owner_login), p_owner_full_name,
     p_owner_phone, lower(p_owner_email), 'all');

  insert into pharmacy.employee_credentials
    (tenant_id, employee_id, one_time_code_hash, one_time_code_expires_at)
  values (p_tenant_id, p_owner_employee_id, p_code_hash, p_code_expires_at);
end;
$$;
alter function pharmacy.provision_tenant(
  uuid, text, text, text, text, uuid, uuid, jsonb, text, text, text, text, text, timestamptz
) owner to pharmacy_provisioner;
revoke all on function pharmacy.provision_tenant(
  uuid, text, text, text, text, uuid, uuid, jsonb, text, text, text, text, text, timestamptz
) from public;
grant execute on function pharmacy.provision_tenant(
  uuid, text, text, text, text, uuid, uuid, jsonb, text, text, text, text, text, timestamptz
) to pharmacy_platform;

-- issue_owner_code - a new one-time activation code of the owner of an active network: only the
-- code hash and its expiry change (the password stays until the code is used). False when the
-- network is not active or has no active owner.
create function pharmacy.issue_owner_code(
  p_tenant_id uuid,
  p_code_hash text,
  p_expires_at timestamptz
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid;
begin
  select e.id into v_owner
  from pharmacy.tenants t
  join pharmacy.roles r on r.tenant_id = t.id and r.is_owner
  join pharmacy.employees e on e.tenant_id = r.tenant_id and e.role_id = r.id
  where t.id = p_tenant_id and t.status = 'active' and e.status = 'active';
  if v_owner is null then
    return false;
  end if;

  insert into pharmacy.employee_credentials
    (tenant_id, employee_id, one_time_code_hash, one_time_code_expires_at)
  values (p_tenant_id, v_owner, p_code_hash, p_expires_at)
  on conflict (tenant_id, employee_id) do update set
    one_time_code_hash = excluded.one_time_code_hash,
    one_time_code_expires_at = excluded.one_time_code_expires_at,
    updated_at = now();
  return true;
end;
$$;
alter function pharmacy.issue_owner_code(uuid, text, timestamptz) owner to pharmacy_provisioner;
revoke all on function pharmacy.issue_owner_code(uuid, text, timestamptz) from public;
grant execute on function pharmacy.issue_owner_code(uuid, text, timestamptz) to pharmacy_platform;
