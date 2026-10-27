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
#
# The passwords come from PHARMACY_<ROLE>_PASSWORD_FILE in test and prod (compose secrets, ADR-0021) and from
# PHARMACY_<ROLE>_PASSWORD in dev. They reach psql through its environment (\getenv), never its arguments: those are
# visible to every user of the host in the process list. The entrypoint sources this file (bash) or runs it (sh, when
# the build context gave it the executable bit), so it is plain POSIX sh either way.
set -eu

# role_password <VARIABLE> — the value of <VARIABLE>_FILE, else of <VARIABLE>; empty stops initdb.
role_password() {
  eval "role_file=\${$1_FILE:-}"
  if [ -n "$role_file" ]; then
    role_value=$(cat "$role_file") || { echo "01-roles.sh: cannot read $1_FILE ($role_file)" >&2; exit 1; }
  else
    eval "role_value=\${$1:-}"
  fi
  [ -n "$role_value" ] || { echo "01-roles.sh: $1 (or $1_FILE) is required" >&2; exit 1; }
  printf '%s' "$role_value"
}

owner_pw=$(role_password PHARMACY_OWNER_PASSWORD)
app_pw=$(role_password PHARMACY_APP_PASSWORD)
platform_pw=$(role_password PHARMACY_PLATFORM_PASSWORD)

owner_pw="$owner_pw" app_pw="$app_pw" platform_pw="$platform_pw" \
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -v db="$POSTGRES_DB" <<'SQL'
\getenv owner_pw owner_pw
\getenv app_pw app_pw
\getenv platform_pw platform_pw
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
unset owner_pw app_pw platform_pw

# Optional test database (dev only): empty, owned by pharmacy_owner; the schema is prepared by the test setup.
if [ -n "${PHARMACY_TEST_DATABASE:-}" ]; then
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
    -v test_db="$PHARMACY_TEST_DATABASE" <<'SQL'
create database :"test_db" owner pharmacy_owner;
SQL
fi
