-- Up Migration
-- The wholesale sale to an organisation (spec 2026-11-03-pos-store-ideas, I4, D19–D27; ADR-0015 and ADR-0018,
-- amendments 2026-11-03; plan 2026-11-03-pos-store-ideas-pr3, R2, R3, R10):
--   store_products.wholesale_price_per_pack_dirams - the wholesale price of a pack at the store; null - the product is
--     not sold wholesale there. Set only next to a retail price (the API); it does not move price_version, the base of
--     the price conflicts of an offline store.
--   receipts.sale_kind, buyer_*                    - a wholesale receipt names its buyer: the organisation, its
--     9-digit tax id and, optionally, the basis (a contract or a power of attorney); a retail receipt has none. A
--     wholesale receipt carries no discount. The rules are checked by the API; these CHECKs are the last line.
-- NOT VALID: the new columns are empty, the checks are validated by the next migration without the ACCESS EXCLUSIVE
-- scan of receipts. store_products and receipts are read by every POS request: do not queue them behind a long lock.
set local lock_timeout = '5s';

alter table pharmacy.store_products
  add column wholesale_price_per_pack_dirams bigint,
  add constraint store_products_wholesale_price_check check (wholesale_price_per_pack_dirams > 0) not valid;

alter table pharmacy.receipts
  add column sale_kind text not null default 'retail',
  add column buyer_name text,
  add column buyer_tax_id text,
  add column buyer_basis text,
  add constraint receipts_sale_kind_check check (sale_kind in ('retail', 'wholesale')
    and (sale_kind = 'retail' or (discount_rule_id is null and discount_dirams = 0))) not valid,
  add constraint receipts_buyer_check check ((sale_kind = 'wholesale') = (buyer_name is not null and buyer_tax_id is not null)
    and (sale_kind = 'wholesale' or buyer_basis is null)
    and (buyer_name is null or char_length(buyer_name) between 1 and 200)
    and (buyer_tax_id is null or buyer_tax_id ~ '^[0-9]{9}$')
    and (buyer_basis is null or char_length(buyer_basis) between 1 and 200)) not valid;
