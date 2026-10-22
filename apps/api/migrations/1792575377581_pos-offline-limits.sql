-- Up Migration
-- POS PR 3 (spec 2026-10-21-pos-offline-limits, section 3; data model 01, 04):
--   tenant_settings          - the limits of the POS buffer of the network (P6): 24 h / 500 operations, ПКУ 8 h / 20
--                              receipts; the ПКУ limits are not above the general ones.
--   receipts.local_number    - the number of the receipt of the terminal within its shift (P12); not unique: a
--                              browser whose data was cleared counts on from the server's count of the shift.
--   controlled_sale_records  - the prescription data is purged by the retention term (P3, P4): an update may only
--                              clear the note and the file and set prescription_purged_at, once; a row is never
--                              deleted.
--   sync_inbox               - a partial index of the envelopes that still hold prescription data (P5).
--   audit_log                - a partial index of the PIN sign-ins of a terminal: who held it at the moment of an
--                              operation sent under it (P10).
set local lock_timeout = '5s';

alter table pharmacy.tenant_settings
  add column pos_buffer_max_hours integer not null default 24
    check (pos_buffer_max_hours between 1 and 72),
  add column pos_buffer_max_operations integer not null default 500
    check (pos_buffer_max_operations between 50 and 2000),
  add column pos_controlled_max_hours integer not null default 8
    check (pos_controlled_max_hours between 1 and 24),
  add column pos_controlled_max_operations integer not null default 20
    check (pos_controlled_max_operations between 1 and 200),
  add constraint tenant_settings_pos_controlled_limits_check check (
    pos_controlled_max_hours <= pos_buffer_max_hours
    and pos_controlled_max_operations <= pos_buffer_max_operations);

-- NOT VALID: the new column is empty, the check is validated by the next migration without the ACCESS EXCLUSIVE scan.
alter table pharmacy.receipts
  add column local_number integer,
  add constraint receipts_local_number_check check (local_number between 1 and 999999) not valid;

-- The one exception of the append-only table: the purge of the prescription data (data model 04).
create function pharmacy.controlled_purge_only() returns trigger
language plpgsql as $$
begin
  -- every other column, a future one too, stays as it was
  if old.prescription_purged_at is null
     and new.prescription_purged_at is not null
     and new.prescription_note is null
     and new.prescription_file_id is null
     and to_jsonb(new) - array['prescription_note', 'prescription_file_id', 'prescription_purged_at']
         = to_jsonb(old) - array['prescription_note', 'prescription_file_id', 'prescription_purged_at'] then
    return new;
  end if;
  raise exception 'pharmacy.% is append-only: % is not allowed', tg_table_name, tg_op
    using errcode = '42501';  -- insufficient_privilege
end;
$$;

drop trigger controlled_sale_records_no_update_delete on pharmacy.controlled_sale_records;
create trigger controlled_sale_records_no_delete
  before delete on pharmacy.controlled_sale_records
  for each row execute function pharmacy.forbid_mutation();
create trigger controlled_sale_records_purge_only
  before update on pharmacy.controlled_sale_records
  for each row execute function pharmacy.controlled_purge_only();

grant update (prescription_file_id, prescription_note, prescription_purged_at)
  on pharmacy.controlled_sale_records to pharmacy_app;

-- The hourly purge pass reads the records not purged yet that hold data, by the time of the sale (a record without
-- data is never purged and does not stay in the index).
create index controlled_sale_records_purge_idx on pharmacy.controlled_sale_records (tenant_id, recorded_at)
  where prescription_purged_at is null and (prescription_note is not null or prescription_file_id is not null);

-- The envelopes of the sales of offline stores that still hold prescription data (P5): a purged envelope leaves the
-- index, so the hourly pass does not read the history again. The predicate is the one of InboxRetention.
-- Who held a terminal at a moment (P10): the PIN sign-ins of the terminal by time; on the partitioned parent, so every
-- partition — a future one too — gets it.
create index audit_log_pin_sign_in_idx on pharmacy.audit_log (tenant_id, terminal_id, recorded_at)
  where action = 'auth.pin-succeeded';

create index sync_inbox_prescription_purge_idx on pharmacy.sync_inbox (tenant_id, received_at)
  where type = 'receipt.completed'
    and envelope @? '$.payload.controlledRecords[*] ? (@.prescriptionNote != null || @.prescriptionFileId != null)';
