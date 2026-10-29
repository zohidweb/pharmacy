-- Up Migration
-- The public site (ADR-0023, spec 2026-10-28-public-site-design, 7.1 and 7.4), final review: a declined request keeps
-- the reason of the refusal until its anonymization, which sets the reason to null with the other personal data (it
-- may name the person). Added NOT VALID and then validated in the same migration transaction: that gives no lighter
-- lock (the transaction holds the table lock until its end), and it does not matter: the table is new and small.

set local lock_timeout = '5s';

alter table pharmacy.connection_requests
  add constraint connection_requests_rejected_has_reason_check
    check (status <> 'rejected' or reject_reason is not null or anonymized_at is not null) not valid;
alter table pharmacy.connection_requests validate constraint connection_requests_rejected_has_reason_check;
