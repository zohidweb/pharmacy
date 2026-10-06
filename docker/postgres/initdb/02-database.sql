-- Runs as pharmacy_owner (initdb: via SET ROLE; tests: connected as the owner). Empty database only.
set role pharmacy_owner;
revoke all on schema public from public;
create schema pharmacy;
grant usage on schema pharmacy to pharmacy_app, pharmacy_platform, pharmacy_resolver, pharmacy_provisioner;
grant create on schema pharmacy to pharmacy_resolver;  -- ALTER FUNCTION … OWNER TO pharmacy_resolver (ADR-0013)
grant create on schema pharmacy to pharmacy_provisioner;  -- … OWNER TO pharmacy_provisioner (ADR-0013, 2026-10-05)
alter default privileges for role pharmacy_owner revoke execute on functions from public;
create extension if not exists pg_trgm schema pharmacy;  -- catalog search RU/TJ
