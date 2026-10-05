-- Up Migration
-- Auth part 2: the pre-context resolver resolve_terminal (ADR-0013 p. 3, auth design 2026-10-02
-- section 8) and the terminal name uniqueness among active terminals only.

-- A browser that binds again revokes its old terminal and gets a new row; the old row keeps its
-- name for history, so the name is unique among terminals that are not revoked.
alter table pharmacy.terminals drop constraint terminals_tenant_id_store_id_name_key;
create unique index terminals_active_name_uq on pharmacy.terminals (tenant_id, store_id, name)
  where revoked_at is null;

-- resolve_terminal - pre-context resolver: the device-cookie SHA-256 to its terminal. Exact match
-- on the unique credential_hash; returns ids, the revocation flag and the tenant status only.
create function pharmacy.resolve_terminal(p_credential_hash bytea)
returns table (tenant_id uuid, store_id uuid, terminal_id uuid, revoked boolean, tenant_status text)
language sql stable security definer set search_path = '' as $$
  select t.tenant_id, t.store_id, t.id, t.revoked_at is not null, n.status
  from pharmacy.terminals t
  join pharmacy.tenants n on n.id = t.tenant_id
  where t.credential_hash = p_credential_hash
$$;
alter function pharmacy.resolve_terminal(bytea) owner to pharmacy_resolver;
revoke all on function pharmacy.resolve_terminal(bytea) from public;
grant execute on function pharmacy.resolve_terminal(bytea) to pharmacy_app;

-- The resolver reads only the columns it needs; FORCE RLS applies to it, hence the policy.
create policy resolver_read on pharmacy.terminals for select to pharmacy_resolver using (true);
grant select (tenant_id, id, store_id, credential_hash, revoked_at) on pharmacy.terminals
  to pharmacy_resolver;
