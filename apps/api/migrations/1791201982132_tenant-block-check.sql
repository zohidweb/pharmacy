-- Up Migration
-- Relaxes tenants_block_check (1791201607296_tenant-provisioning): the block fields are set together
-- and only on a blocked tenant, but a tenant blocked outside the operator flow (older data, seeds)
-- may have none of them. The operator's block always sets all three.
alter table pharmacy.tenants drop constraint tenants_block_check;
alter table pharmacy.tenants add constraint tenants_block_check check (
  (blocked_at is null) = (blocked_by is null)
  and (blocked_at is null) = (block_reason is null)
  and (status = 'blocked' or blocked_at is null)
);
