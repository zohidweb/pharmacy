-- pharmacy_provisioner (ADR-0013, amendment 2026-10-05): NOLOGIN owner of the SECURITY DEFINER tenant
-- provisioning functions. A new cluster gets it from 01-roles.sh; this file is idempotent, so it is a
-- no-op there and adds the role to a cluster created before the amendment. Run once as the superuser:
--   docker compose --project-name pharmacy-dev --env-file .env -f docker/compose.yml \
--     -f docker/compose.dev.yml exec -T postgres sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
--     < docker/postgres/initdb/03-provisioner-role.sql
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'pharmacy_provisioner') then
    create role pharmacy_provisioner nologin nosuperuser nocreatedb nocreaterole nobypassrls;
  end if;
end
$$;
grant pharmacy_provisioner to pharmacy_owner;
grant usage, create on schema pharmacy to pharmacy_provisioner;
