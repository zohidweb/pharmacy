-- Up Migration
-- Supplier names are unique in the network whatever the case (spec 2026-10-09-inventory-purchasing,
-- section 5.1): the application checks it, the index keeps it under concurrent writes.
create unique index suppliers_name_uq on pharmacy.suppliers (tenant_id, lower(name));
