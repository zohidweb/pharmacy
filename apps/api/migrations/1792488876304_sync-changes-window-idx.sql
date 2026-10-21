-- Up Migration
-- The window of the change feed drops rows by their time (spec 2026-10-16-offline-sync, E22): an index on it, so
-- that the drop of a read never scans the network's whole feed (final review of PR 3a, I2). sync_changes is new and
-- small everywhere, so the index is built in place.
create index sync_changes_changed_idx on pharmacy.sync_changes (tenant_id, changed_at);
