-- Up Migration
-- platform_audit_log.correlation_id becomes text, like every other correlation_id (audit_log, receipts,
-- customer_returns, sync_runs). The request correlation id is a well-formed client X-Correlation-Id
-- (CorrelationIdMiddleware: letters, digits and hyphens, 8–64) or a random UUID; a client id that is not a UUID
-- made every operator write appending to this log fail with 22P02 (500). Nothing depends on the uuid type: no
-- index, constraint, view, policy or function reads the column. The type change rewrites the table (low volume)
-- under ACCESS EXCLUSIVE; the row and statement triggers that forbid UPDATE/DELETE/TRUNCATE do not fire on it.
set local lock_timeout = '5s';

alter table pharmacy.platform_audit_log
  alter column correlation_id type text using correlation_id::text;
