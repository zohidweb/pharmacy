-- Up Migration
-- Default roles of a new network (spec 2026-10-06-staff-design, section 3; ADR-0013, amendment
-- 2026-10-05, p. 6): provision_tenant creates «Заведующий точкой», «Фармацевт-кассир» and
-- «Бухгалтер» next to the owner role. They are ordinary roles of the network (template_key is
-- null): the application passes their names and default permissions (roleTemplates of
-- libs/shared/domain) as one jsonb array; the network changes them like any role of its own.
drop function pharmacy.provision_tenant(uuid, text, text, text, text, uuid, uuid, jsonb, text, text, text, text, text, timestamptz);

grant insert on pharmacy.role_permissions to pharmacy_provisioner;
create policy provisioner_all on pharmacy.role_permissions for all to pharmacy_provisioner
  using (true) with check (true);

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
  p_code_expires_at timestamptz,
  p_default_roles jsonb
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_role jsonb;
begin
  if jsonb_typeof(p_default_roles) is distinct from 'array' then
    raise exception 'p_default_roles must be a json array' using errcode = '22023';
  end if;

  insert into pharmacy.tenants
    (id, code, name, city, billing_tax_id, owner_full_name, owner_login, owner_phone, owner_email)
  values
    (p_tenant_id, p_code, p_name, p_city, p_inn, p_owner_full_name, lower(p_owner_login),
     p_owner_phone, lower(p_owner_email));

  insert into pharmacy.tenant_settings (tenant_id) values (p_tenant_id);

  insert into pharmacy.roles (tenant_id, id, name, is_owner, template_key)
  values (p_tenant_id, p_owner_role_id, p_owner_role_name, true, 'owner');

  for v_role in select * from jsonb_array_elements(p_default_roles) loop
    if jsonb_typeof(v_role -> 'name') is distinct from 'object'
       or jsonb_typeof(v_role -> 'permissions') is distinct from 'array'
       or (v_role ->> 'id') is null then
      raise exception 'a default role needs id, name and permissions' using errcode = '22023';
    end if;
    insert into pharmacy.roles (tenant_id, id, name, is_owner, template_key)
    values (p_tenant_id, (v_role ->> 'id')::uuid, v_role -> 'name', false, null);
    insert into pharmacy.role_permissions (tenant_id, role_id, permission)
    select p_tenant_id, (v_role ->> 'id')::uuid, p.permission
    from jsonb_array_elements_text(v_role -> 'permissions') as p(permission);
  end loop;

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
alter function pharmacy.provision_tenant(uuid, text, text, text, text, uuid, uuid, jsonb, text, text, text, text, text, timestamptz, jsonb)
  owner to pharmacy_provisioner;
revoke all on function pharmacy.provision_tenant(uuid, text, text, text, text, uuid, uuid, jsonb, text, text, text, text, text, timestamptz, jsonb)
  from public;
grant execute on function pharmacy.provision_tenant(uuid, text, text, text, text, uuid, uuid, jsonb, text, text, text, text, text, timestamptz, jsonb)
  to pharmacy_platform;

-- Networks created before this migration (dev/test only) get the three roles once. The owner of
-- the database is a member of pharmacy_provisioner: under that role the inserts pass its RLS
-- policies. One-time copy of roleTemplates (libs/shared/domain), 2026-10-07.
set local role pharmacy_provisioner;
do $$
declare
  v_tenant uuid;
  v_role uuid;
  v_def record;
begin
  for v_tenant in
    select t.id from pharmacy.tenants t
    where not exists (
      select 1 from pharmacy.roles r where r.tenant_id = t.id and not r.is_owner)
  loop
    for v_def in
      select * from (values
        ('{"ru": "Заведующий точкой", "tj": "Мудири нуқта"}'::jsonb, array['pos:view', 'pos:create', 'shifts:view', 'shifts:create', 'shifts:update', 'returns:view', 'returns:create', 'inventory:view', 'catalog:view', 'pricing:view', 'pos:sell-controlled', 'pos:choose-batch', 'returns:without-receipt', 'inventory:create', 'inventory:update', 'inventory:post', 'inventory:unpost', 'inventory:delete', 'inventory:receive', 'inventory:export', 'purchasing:view', 'purchasing:create', 'purchasing:update', 'purchasing:post', 'purchasing:delete', 'purchasing:export', 'catalog:create', 'catalog:update', 'catalog:export', 'pricing:update-store', 'discounts:view', 'discounts:manage-store', 'finance:view-cost', 'reports:view', 'reports:export', 'employees:view', 'employees:create', 'employees:update', 'employees:assign-role', 'roles:view', 'terminals:view', 'terminals:create', 'terminals:delete', 'stores:view', 'audit:view', 'settings:view', 'sync:view', 'sync:run']),
        ('{"ru": "Фармацевт-кассир", "tj": "Фармасевт-хазинадор"}'::jsonb, array['pos:view', 'pos:create', 'shifts:view', 'shifts:create', 'shifts:update', 'returns:view', 'returns:create', 'inventory:view', 'catalog:view', 'pricing:view']),
        ('{"ru": "Бухгалтер", "tj": "Муҳосиб"}'::jsonb, array['inventory:view', 'inventory:export', 'purchasing:view', 'purchasing:export', 'catalog:view', 'pricing:view', 'finance:view-cost', 'reports:view', 'reports:export', 'export-1c:view', 'export-1c:export', 'stores:view', 'audit:view', 'audit:export'])
      ) as d(name, permissions)
    loop
      v_role := gen_random_uuid();
      insert into pharmacy.roles (tenant_id, id, name, is_owner, template_key)
      values (v_tenant, v_role, v_def.name, false, null);
      insert into pharmacy.role_permissions (tenant_id, role_id, permission)
      select v_tenant, v_role, unnest(v_def.permissions);
    end loop;
  end loop;
end;
$$;
reset role;
