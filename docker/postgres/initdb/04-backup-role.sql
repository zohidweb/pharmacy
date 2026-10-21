-- pharmacy_backup (ADR-0019): the read-only role of the backup service — LOGIN, BYPASSRLS, member of
-- pg_read_all_data, no superuser. Idempotent: creates the role or updates its attributes and password from
-- PHARMACY_BACKUP_PASSWORD in the environment of the postgres container; without the variable (dev) it does nothing.
-- Runs as the superuser: once by initdb on a new cluster, and on every `npm run stack -- <test|prod> up`, which
-- brings the role to an existing cluster and applies a changed password:
--   docker compose ... exec -T postgres sh -c \
--     'psql -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /docker-entrypoint-initdb.d/04-backup-role.sql'
-- psql variables are not substituted inside DO $$ … $$, hence \gexec. The password reaches the server log only with
-- log_statement = ddl or all, or when the statement fails.
\getenv backup_pw PHARMACY_BACKUP_PASSWORD
\if :{?backup_pw}
select 'create role pharmacy_backup'
where not exists (select 1 from pg_roles where rolname = 'pharmacy_backup') \gexec
select format(
  'alter role pharmacy_backup with login nosuperuser nocreatedb nocreaterole bypassrls connection limit 2 password %L',
  :'backup_pw'
) \gexec
select 'grant pg_read_all_data to pharmacy_backup'
where not pg_has_role('pharmacy_backup', 'pg_read_all_data', 'member') \gexec
\endif
