-- Up Migration
-- Idempotent store creation (spec 2026-10-06-owner-stores, section 4): POST /stores keeps the
-- Idempotency-Key in the store row, so a retried form returns the same store instead of a second
-- one. Unique within the network when set.
alter table pharmacy.stores add column idempotency_key uuid;
create unique index stores_idempotency_key_uq on pharmacy.stores (tenant_id, idempotency_key)
  where idempotency_key is not null;
