-- Up Migration
-- A batch made by a product merge of an offline store keeps the batch of the store's product it came from
-- (spec 2026-10-16-offline-sync, E35), as a transfer batch keeps the sender's: source_batch_id is set for both.
set local lock_timeout = '5s';
alter table pharmacy.batches drop constraint batches_source_batch_check;
alter table pharmacy.batches add constraint batches_source_batch_check
  check ((origin in ('transfer', 'product_merge')) = (source_batch_id is not null));
