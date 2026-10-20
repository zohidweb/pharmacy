-- Up Migration
-- The change feed numbers per network (final review of PR 3a, M4, M6, M7):
--   sync_feed_state.last_seq - the last number given to a change of the network, taken under the advisory lock of the
--                              network at read time; it replaces the platform-wide sequence, whose gaps showed a key
--                              holder the feed volume of other networks, and bounds a valid cursor (a cursor above
--                              it — e.g. after a restore of the cloud — must resync);
--   sync_changes_scope_idx   - partial: almost every change is of the whole network (scope null).
-- sync_changes is new everywhere (no row predates its own PR), so nothing is carried over.
set local lock_timeout = '5s';
alter table pharmacy.sync_feed_state
  add column last_seq bigint not null default 0 check (last_seq >= 0);
drop sequence pharmacy.sync_change_seq;
drop index pharmacy.sync_changes_scope_idx;
create index sync_changes_scope_idx on pharmacy.sync_changes (tenant_id, scope_store_id)
  where scope_store_id is not null;
