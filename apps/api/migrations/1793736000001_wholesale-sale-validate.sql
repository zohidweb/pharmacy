-- Up Migration
-- The wholesale sale (plan 2026-11-03-pos-store-ideas-pr3, R10): the checks added NOT VALID by the previous migration
-- are validated here under SHARE UPDATE EXCLUSIVE — sales and price changes go on while the tables are scanned.
set local lock_timeout = '5s';
alter table pharmacy.store_products validate constraint store_products_wholesale_price_check;
alter table pharmacy.receipts validate constraint receipts_sale_kind_check;
alter table pharmacy.receipts validate constraint receipts_buyer_check;
