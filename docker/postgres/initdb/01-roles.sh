#!/bin/sh
# Runs once, on an empty data directory, as the superuser. Role model: ADR-0013;
# .claude/skills/postgres-best-practices/rules/security-privileges.md
#   pharmacy_owner    - owns the database and schema, used only by migrations;
#   pharmacy_app      - runtime role of apps/api (tenant paths, RLS applies);
#   pharmacy_platform - runtime role of the cross-tenant platform paths (app/platform/**), no BYPASSRLS;
#   pharmacy_resolver - NOLOGIN owner of SECURITY DEFINER resolver functions (read-only);
#   pharmacy_provisioner - NOLOGIN owner of the SECURITY DEFINER tenant provisioning functions
#                     (ADR-0013, amendment 2026-10-05). Existing clusters: 03-provisioner-role.sql.
# Schema objects are prepared by 02-database.sql (executed as pharmacy_owner).
set -eu
: "${PHARMACY_OWNER_PASSWORD:?PHARMACY_OWNER_PASSWORD is required}"
: "${PHARMACY_APP_PASSWORD:?PHARMACY_APP_PASSWORD is required}"
: "${PHARMACY_PLATFORM_PASSWORD:?PHARMACY_PLATFORM_PASSWORD is required}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v db="$POSTGRES_DB" \
  -v owner_pw="$PHARMACY_OWNER_PASSWORD" -v app_pw="$PHARMACY_APP_PASSWORD" \
  -v platform_pw="$PHARMACY_PLATFORM_PASSWORD" <<'SQL'
create role pharmacy_owner    login   nosuperuser nocreatedb nocreaterole nobypassrls password :'owner_pw';
create role pharmacy_app      login   nosuperuser nocreatedb nocreaterole nobypassrls password :'app_pw';
create role pharmacy_platform login   nosuperuser nocreatedb nocreaterole nobypassrls password :'platform_pw';
create role pharmacy_resolver nologin nosuperuser nocreatedb nocreaterole nobypassrls;
create role pharmacy_provisioner nologin nosuperuser nocreatedb nocreaterole nobypassrls;

alter role pharmacy_owner    set search_path = pharmacy;
alter role pharmacy_app      set search_path = pharmacy;
alter role pharmacy_platform set search_path = pharmacy;

-- The owner may SET ROLE pharmacy_resolver / ALTER FUNCTION ... OWNER TO pharmacy_resolver (ADR-0013).
grant pharmacy_resolver to pharmacy_owner;
grant pharmacy_provisioner to pharmacy_owner;

-- The owner needs CREATE on the database (and owns schema public via pg_database_owner).
alter database :"db" owner to pharmacy_owner;
SQL

# Optional test database (dev only): empty, owned by pharmacy_owner; the schema is prepared by the test setup.
if [ -n "${PHARMACY_TEST_DATABASE:-}" ]; then
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
    -v test_db="$PHARMACY_TEST_DATABASE" <<'SQL'
create database :"test_db" owner pharmacy_owner;
SQL
fi
