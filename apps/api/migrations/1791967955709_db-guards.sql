-- Up Migration
-- Guards and indexes deferred by the reviews (triage of 2026-10-14, package F; data models 03, 05,
-- 06). No new tables or columns: the Kysely types do not change.

-- audit_log, stock_movements: TRUNCATE is forbidden on every partition as well. A statement
-- trigger of a partitioned table is not cloned to its partitions (row triggers are), so
-- `TRUNCATE pharmacy.audit_log_2026_10` went through. A partition created later gets the same
-- trigger (data models 03, 06).
do $$
declare
  part record;
begin
  for part in
    select i.inhrelid::regclass as partition, p.relname as parent
    from pg_inherits i
    join pg_class p on p.oid = i.inhparent
    where i.inhparent in ('pharmacy.audit_log'::regclass, 'pharmacy.stock_movements'::regclass)
    order by 1
  loop
    execute format(
      'create trigger %I before truncate on %s '
      'for each statement execute function pharmacy.forbid_mutation()',
      part.parent || '_no_truncate', part.partition);
  end loop;
end
$$;

-- audit_log: the events about an entity — the history of an employee card, «Мои терминалы». The
-- table is partitioned: the index is built on every partition, without CONCURRENTLY.
create index audit_log_entity_idx
  on pharmacy.audit_log (tenant_id, entity_type, entity_id, recorded_at);

-- platform_audit_log: the operators' journal of one network (the link from the company card).
create index platform_audit_log_tenant_idx
  on pharmacy.platform_audit_log (tenant_id, recorded_at);

-- stock_movements: a reversal always names the movement it reverses, and only a reversal does.
-- Added NOT VALID here (a short lock); the next migration validates it in its own transaction.
alter table pharmacy.stock_movements add constraint stock_movements_reversal_link_check
  check ((kind = 'reversal') = (reverses_movement_id is not null)) not valid;

-- supplier_payments: a payment is a fact, as the ledger entries — append-only (table-classes.ts
-- APPEND_ONLY_TABLES); a wrong one is corrected by a counter entry, not by an update.
revoke update, delete on pharmacy.supplier_payments from pharmacy_app;
create trigger supplier_payments_no_update_delete
  before update or delete on pharmacy.supplier_payments
  for each row execute function pharmacy.forbid_mutation();
create trigger supplier_payments_no_truncate
  before truncate on pharmacy.supplier_payments
  for each statement execute function pharmacy.forbid_mutation();

-- documents: the actors of a transfer, as the other employee references of a document.
create index documents_dispatched_by_idx on pharmacy.documents (tenant_id, dispatched_by);
create index documents_received_by_idx on pharmacy.documents (tenant_id, received_by);
