-- Up Migration
-- issue_owner_code picks one owner deterministically when several active employees hold the owner
-- role: the one whose login is the network's registered owner login (tenants.owner_login, shown in
-- the operator's card), otherwise the earliest created. Same signature, same grants.
grant select (owner_login) on pharmacy.tenants to pharmacy_provisioner;
grant select (login, created_at) on pharmacy.employees to pharmacy_provisioner;

create or replace function pharmacy.issue_owner_code(
  p_tenant_id uuid,
  p_code_hash text,
  p_expires_at timestamptz,
  p_operator_id uuid,
  p_audit_id uuid,
  p_correlation_id text
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid;
begin
  select e.id into v_owner
  from pharmacy.tenants t
  join pharmacy.roles r on r.tenant_id = t.id and r.is_owner
  join pharmacy.employees e on e.tenant_id = r.tenant_id and e.role_id = r.id
  where t.id = p_tenant_id and t.status = 'active' and e.status = 'active'
  order by (lower(e.login) = t.owner_login) desc nulls last, e.created_at, e.id
  limit 1;
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

  -- Today in the network's time zone, as AuditService computes it.
  insert into pharmacy.audit_log
    (tenant_id, id, business_date, acting_operator_id, correlation_id, action, entity_type,
     entity_id, source)
  values
    (p_tenant_id, p_audit_id,
     (now() at time zone coalesce(
       (select s.timezone from pharmacy.tenant_settings s where s.tenant_id = p_tenant_id),
       'Asia/Dushanbe'))::date,
     p_operator_id, p_correlation_id, 'owner.activation-code-issued', 'employee', v_owner, 'cloud');
  return true;
end;
$$;
