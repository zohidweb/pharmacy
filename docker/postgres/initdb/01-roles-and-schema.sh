#!/bin/sh
# Runs once, on an empty data directory. Role model: .claude/skills/postgres-best-practices/rules/security-privileges.md
# pharmacy_owner — owns the schema, used only by migrations; pharmacy_app — runtime role of apps/api.
set -eu
: "${PHARMACY_OWNER_PASSWORD:?PHARMACY_OWNER_PASSWORD is required}"
: "${PHARMACY_APP_PASSWORD:?PHARMACY_APP_PASSWORD is required}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v owner_pw="$PHARMACY_OWNER_PASSWORD" -v app_pw="$PHARMACY_APP_PASSWORD" <<'SQL'
create role pharmacy_owner login nosuperuser nocreatedb nocreaterole nobypassrls password :'owner_pw';
create role pharmacy_app   login nosuperuser nocreatedb nocreaterole nobypassrls password :'app_pw';

revoke all on schema public from public;
create schema pharmacy authorization pharmacy_owner;
grant usage on schema pharmacy to pharmacy_app;
alter role pharmacy_owner set search_path = pharmacy;
alter role pharmacy_app   set search_path = pharmacy;

alter default privileges for role pharmacy_owner in schema pharmacy
  grant select, insert, update, delete on tables to pharmacy_app;
alter default privileges for role pharmacy_owner in schema pharmacy
  grant usage, select on sequences to pharmacy_app;

-- Catalog search RU/TJ (postgres-best-practices: advanced-full-text-search)
create extension if not exists pg_trgm schema pharmacy;
SQL
