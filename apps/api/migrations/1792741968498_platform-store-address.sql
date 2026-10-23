-- Up Migration
-- The address of a store is registry data like its name and kind (ADR-0013, amendment 2026-10-23; spec
-- 2026-10-23-admin-store-card-tenant-log, A2): the store card and the store list of a network in the admin show it.
-- No employees, no other tenant data.
set local lock_timeout = '5s';

grant select (address) on pharmacy.stores to pharmacy_platform;
