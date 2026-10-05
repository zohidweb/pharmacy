-- Up Migration
-- issue_owner_code without INSERT ... ON CONFLICT DO UPDATE, which needs SELECT on the proposed
-- row's columns that pharmacy_provisioner deliberately lacks (42501). The owner's credentials row
-- exists after provision_tenant, so the code is updated in place; the insert covers an owner
-- created otherwise. Same signature, same grants.
create or replace function pharmacy.issue_owner_code(
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

  update pharmacy.employee_credentials
  set one_time_code_hash = p_code_hash,
      one_time_code_expires_at = p_expires_at,
      updated_at = now()
  where tenant_id = p_tenant_id and employee_id = v_owner;
  if not found then
    insert into pharmacy.employee_credentials
      (tenant_id, employee_id, one_time_code_hash, one_time_code_expires_at)
    values (p_tenant_id, v_owner, p_code_hash, p_expires_at);
  end if;
  return true;
end;
$$;
