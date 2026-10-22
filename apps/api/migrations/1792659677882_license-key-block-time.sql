-- Up Migration
-- Security review 2026-10-22 (spec 2026-10-16-offline-sync, E12): the grace of a terminated license runs from its
-- earliest event, and the block of the network is one of them, so resolve_license_key also returns
-- tenants.blocked_at. The returned columns change, hence drop and create; owner and grants as in
-- 1792144500972_sync-receive.
grant select (blocked_at) on pharmacy.tenants to pharmacy_resolver;

drop function pharmacy.resolve_license_key(text);

create function pharmacy.resolve_license_key(p_key_id text)
returns table (key_hash bytea, tenant_id uuid, store_id uuid, status text, valid_until timestamptz,
  revoked_at timestamptz, notify_before_days integer, store_status text, store_closed_at timestamptz,
  store_mode text, tenant_status text, tenant_blocked_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select k.key_hash, k.tenant_id, k.store_id, k.status, k.valid_until, k.revoked_at,
         k.notify_before_days, s.status, s.closed_at, s.mode, n.status, n.blocked_at
  from pharmacy.license_keys k
  join pharmacy.stores s on s.tenant_id = k.tenant_id and s.id = k.store_id
  join pharmacy.tenants n on n.id = k.tenant_id
  where k.key_id = p_key_id
$$;
alter function pharmacy.resolve_license_key(text) owner to pharmacy_resolver;
revoke all on function pharmacy.resolve_license_key(text) from public;
grant execute on function pharmacy.resolve_license_key(text) to pharmacy_app;
