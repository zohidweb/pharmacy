-- Up Migration
-- Validates the keys of cr-M9 added NOT VALID by audit-entity-index-return-keys. Its own file, so its
-- own transaction (apps/api/scripts/migrate.mjs runs no single transaction, rule cr-N3): the scan takes
-- SHARE UPDATE EXCLUSIVE, so sales and returns go on.
set local lock_timeout = '5s';
alter table pharmacy.customer_returns validate constraint customer_returns_store_shift_fkey;
alter table pharmacy.customer_return_lines validate constraint customer_return_lines_receipt_line_fkey;
alter table pharmacy.customer_return_lines validate constraint customer_return_lines_return_receipt_fkey;
