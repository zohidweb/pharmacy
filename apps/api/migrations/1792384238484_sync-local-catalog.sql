-- Up Migration
-- Local products and prices of offline stores (spec 2026-10-16-offline-sync, E25, E26, E35; data model 02, 06):
--   products       - `origin` (cloud / local), the store that created a local card, and the alias of a card merged
--                    into a card of the network (a merged card is archived: E35);
--   sync_conflicts - at most one open conflict per store, kind and entity: a later local change of the same price
--                    or a later duplicate of the same product updates it instead of opening another.

alter table pharmacy.products
  add column origin text not null default 'cloud' check (origin in ('cloud', 'local')),
  add column created_at_store_id uuid,
  add column merged_into_product_id uuid,
  add foreign key (tenant_id, created_at_store_id) references pharmacy.stores (tenant_id, id),
  add foreign key (tenant_id, merged_into_product_id) references pharmacy.products (tenant_id, id),
  add check ((origin = 'local') = (created_at_store_id is not null)),
  add check (
    merged_into_product_id is null
    or (merged_into_product_id <> id and status = 'archived')
  );

create index products_created_at_store_idx on pharmacy.products (tenant_id, created_at_store_id)
  where created_at_store_id is not null;
create index products_merged_into_idx on pharmacy.products (tenant_id, merged_into_product_id)
  where merged_into_product_id is not null;

create unique index sync_conflicts_open_uq on pharmacy.sync_conflicts (tenant_id, store_id, kind, entity_id)
  where status = 'open';
-- its columns are a prefix of the unique index above
drop index pharmacy.sync_conflicts_open_idx;
