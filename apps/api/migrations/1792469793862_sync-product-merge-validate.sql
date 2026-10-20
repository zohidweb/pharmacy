-- Up Migration
-- Validates the checks and keys added NOT VALID by `sync-product-merge` in its own transaction (rule cr-N3): the
-- scans of the big tables take only a SHARE UPDATE EXCLUSIVE lock, sales and postings go on.
set local lock_timeout = '5s';
alter table pharmacy.documents validate constraint documents_type_check;
alter table pharmacy.documents validate constraint documents_tenant_id_merge_from_product_id_fkey;
alter table pharmacy.documents validate constraint documents_tenant_id_merge_into_product_id_fkey;
alter table pharmacy.documents validate constraint documents_merge_type_check;
alter table pharmacy.batches validate constraint batches_origin_check;
alter table pharmacy.stock_movements validate constraint stock_movements_kind_check;
