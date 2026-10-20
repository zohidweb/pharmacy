-- Up Migration
-- Validates the source batch check of `sync-product-merge-source-batch` in its own transaction (rule cr-N3).
set local lock_timeout = '5s';
alter table pharmacy.batches validate constraint batches_source_batch_check;
