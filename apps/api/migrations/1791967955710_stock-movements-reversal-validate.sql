-- Up Migration
-- Validates the reversal link check added NOT VALID by db-guards. Its own file, so its own
-- transaction (the runner has no single transaction): the scan takes SHARE UPDATE EXCLUSIVE, so
-- sales and stock reads go on, instead of the ACCESS EXCLUSIVE lock of the ADD held to the end.
alter table pharmacy.stock_movements validate constraint stock_movements_reversal_link_check;
