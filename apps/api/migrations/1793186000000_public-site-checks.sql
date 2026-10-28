-- Up Migration
-- The public site (ADR-0023, spec 2026-10-28-public-site-design, 7.1 and 7.4), final review: a declined request keeps
-- the reason of the refusal until its anonymization, which sets the reason to null with the other personal data (it
-- may name the person). Added NOT VALID and validated apart: the validation takes a lighter lock than the check.

set local lock_timeout = '5s';

alter table pharmacy.connection_requests
  add constraint connection_requests_rejected_has_reason_check
    check (status <> 'rejected' or reject_reason is not null or anonymized_at is not null) not valid;
alter table pharmacy.connection_requests validate constraint connection_requests_rejected_has_reason_check;
