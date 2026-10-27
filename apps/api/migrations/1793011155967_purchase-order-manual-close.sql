-- Up Migration
-- A purchase order closed by hand (spec 2026-10-26-pilot-small-gaps, P3, P4; data model 05): who and when. A goods
-- receipt by the order unposted later leaves it closed: the recount of the status keeps a closing by hand.
-- purchase_orders is small and written by goods receipts: do not queue them behind a long lock.
set local lock_timeout = '5s';

alter table pharmacy.purchase_orders
  add column closed_manually_at timestamptz,
  add column closed_manually_by uuid,
  add constraint purchase_orders_closed_manually_by_fkey
    foreign key (tenant_id, closed_manually_by) references pharmacy.employees (tenant_id, id),
  add constraint purchase_orders_closed_manually_check check (
    (closed_manually_at is null) = (closed_manually_by is null)
    and (closed_manually_at is null or status = 'closed')
  );

create index purchase_orders_closed_manually_by_idx
  on pharmacy.purchase_orders (tenant_id, closed_manually_by);
