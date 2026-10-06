-- Up Migration
-- A new owner code is visible to the owner (ADR-0008, amendment 2026-10-05, decision of 2026-10-06):
-- issue_owner_code also appends an audit_log row of the network with the operator in
-- acting_operator_id, in the same transaction as the code. The operator who hands the code over
-- could use it himself; the owner sees that a code was issued, by whom and when.
drop function pharmacy.issue_owner_code(uuid, text, timestamptz);

grant select (tenant_id, timezone) on pharmacy.tenant_settings to pharmacy_provisioner;
grant insert on pharmacy.audit_log to pharmacy_provisioner;
create policy provisioner_insert on pharmacy.audit_log for insert to pharmacy_provisioner
  with check (true);

create function pharmacy.issue_owner_code(
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
alter function pharmacy.issue_owner_code(uuid, text, timestamptz, uuid, uuid, text)
  owner to pharmacy_provisioner;
revoke all on function pharmacy.issue_owner_code(uuid, text, timestamptz, uuid, uuid, text)
  from public;
grant execute on function pharmacy.issue_owner_code(uuid, text, timestamptz, uuid, uuid, text)
  to pharmacy_platform;
