-- Up Migration
-- POS PR 3 (spec 2026-10-21-pos-offline-limits, section 3): the check of receipts.local_number added NOT VALID by the
-- previous migration is validated here under SHARE UPDATE EXCLUSIVE — sales go on while the table is scanned.
set local lock_timeout = '5s';
alter table pharmacy.receipts validate constraint receipts_local_number_check;
