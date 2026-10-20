-- Up Migration
-- Validates the movement kinds added NOT VALID by `sync-product-merge` in its own transaction (rule cr-N3): the scan
-- of the big partitioned table takes only a SHARE UPDATE EXCLUSIVE lock.
set local lock_timeout = '5s';
alter table pharmacy.stock_movements validate constraint stock_movements_kind_check;
