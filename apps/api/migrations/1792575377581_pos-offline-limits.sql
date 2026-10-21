-- Up Migration
-- POS PR 3 (spec 2026-10-21-pos-offline-limits, section 3; data model 01, 04):
--   tenant_settings          - the limits of the POS buffer of the network (P6): 24 h / 500 operations, ПКУ 8 h / 20
--                              receipts; the ПКУ limits are not above the general ones.
--   receipts.local_number    - the number of the receipt of the terminal within its shift (P12); not unique: a
--                              browser whose data was cleared counts on from the server's count of the shift.
--   controlled_sale_records  - the prescription data is purged by the retention term (P3, P4): an update may only
--                              clear the note and the file and set prescription_purged_at, once; a row is never
--                              deleted.
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

alter table pharmacy.receipts
  add column local_number integer check (local_number between 1 and 999999);

-- The one exception of the append-only table: the purge of the prescription data (data model 04).
create function pharmacy.controlled_purge_only() returns trigger
language plpgsql as $$
begin
  if old.prescription_purged_at is null
     and new.prescription_purged_at is not null
     and new.prescription_note is null
     and new.prescription_file_id is null
     and (new.tenant_id, new.id, new.receipt_line_id, new.recorded_by, new.recorded_at, new.created_at)
         is not distinct from
         (old.tenant_id, old.id, old.receipt_line_id, old.recorded_by, old.recorded_at, old.created_at) then
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

-- The hourly purge pass reads the records not purged yet by the time of the sale.
create index controlled_sale_records_purge_idx on pharmacy.controlled_sale_records (tenant_id, recorded_at)
  where prescription_purged_at is null;
