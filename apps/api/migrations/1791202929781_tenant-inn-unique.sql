-- Up Migration
-- One network per INN (spec 2026-10-05-tenants-module; the admin contract already answers 409
-- inn_taken). billing_tax_id holds the INN; networks without one are not constrained.
create unique index tenants_inn_uq on pharmacy.tenants (billing_tax_id) where billing_tax_id is not null;
