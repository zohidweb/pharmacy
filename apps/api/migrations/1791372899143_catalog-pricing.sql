-- Up Migration
-- Catalog and prices (data model 02-catalog-prices.md; spec 2026-10-07-catalog-pricing, section 3):
-- categories, dosage forms, products with barcodes, retail prices of a product at a store, and
-- discount rules. Only the columns with a consumer now; columns of sync, the drug reference, goods
-- receipts and stock come with their modules. All tables are of class `tenant` (ADR-0013).

-- categories - flat list of the network; markup_bp null - no markup of the category.
create table pharmacy.categories (
  tenant_id uuid not null references pharmacy.tenants (id),
  id uuid not null,
  name jsonb not null check (jsonb_typeof(name) = 'object' and name <> '{}'::jsonb),
  markup_bp integer check (markup_bp >= 0),
  pos_sort_order integer not null default 0,
  status text not null default 'active' check (status in ('active', 'archived')),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id),
  check (status <> 'archived' or archived_at is not null)
);

-- dictionary_values - value lists of the network; system values carry a stable code.
create table pharmacy.dictionary_values (
  tenant_id uuid not null references pharmacy.tenants (id),
  id uuid not null,
  kind text not null check (kind in ('dosage_form')),
  code text,
  name jsonb not null check (jsonb_typeof(name) = 'object' and name <> '{}'::jsonb),
  is_system boolean not null default false,
  status text not null default 'active' check (status in ('active', 'archived')),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, kind, code),
  check (status <> 'archived' or archived_at is not null)
);

-- products - the product card (D4): every attribute is the network's own.
create table pharmacy.products (
  tenant_id uuid not null references pharmacy.tenants (id),
  id uuid not null,
  name jsonb not null check (jsonb_typeof(name) = 'object' and name <> '{}'::jsonb),
  inn jsonb check (inn is null or (jsonb_typeof(inn) = 'object' and inn <> '{}'::jsonb)),
  dosage_form text,
  dosage text,
  manufacturer text,
  country text check (country ~ '^[A-Z]{2}$'),
  unit text not null check (unit in ('pack', 'piece', 'ml')),
  pieces_per_pack integer not null default 1 check (pieces_per_pack >= 1),
  sold_by_piece boolean not null default false,
  is_prescription boolean not null default false,
  is_controlled boolean not null default false,
  is_price_regulated boolean not null default false,
  max_retail_price_per_pack_dirams bigint check (max_retail_price_per_pack_dirams > 0),
  category_id uuid not null,
  markup_bp integer check (markup_bp >= 0),
  default_min_stock_pieces integer check (default_min_stock_pieces >= 0),
  article text,
  status text not null default 'active' check (status in ('active', 'archived')),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, category_id) references pharmacy.categories (tenant_id, id),
  check (not sold_by_piece or pieces_per_pack > 1),
  check (not is_controlled or is_prescription),
  check (is_price_regulated = (max_retail_price_per_pack_dirams is not null)),
  check (status <> 'archived' or archived_at is not null)
);
create index products_name_ru_trgm on pharmacy.products
  using gin (lower(name ->> 'ru') pharmacy.gin_trgm_ops);
create index products_name_tj_trgm on pharmacy.products
  using gin (lower(name ->> 'tj') pharmacy.gin_trgm_ops);
create index products_inn_idx on pharmacy.products (tenant_id, lower(inn ->> 'ru'));
create index products_category_idx on pharmacy.products (tenant_id, category_id);
create unique index products_article_uq on pharmacy.products (tenant_id, lower(article))
  where article is not null;

-- product_barcodes - a barcode is unique in the network: a scan finds one card (БЛ W1-04).
create table pharmacy.product_barcodes (
  tenant_id uuid not null references pharmacy.tenants (id),
  barcode text not null check (barcode ~ '^[0-9]{8,14}$'),
  product_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, barcode),
  foreign key (tenant_id, product_id) references pharmacy.products (tenant_id, id)
);
create index product_barcodes_product_idx on pharmacy.product_barcodes (tenant_id, product_id);

-- store_products - a product at a store: the retail price is unique for the pair (БЛ 6.2); no price
-- - the product is not sold at the store. price_version grows with every change (ADR-0014).
create table pharmacy.store_products (
  tenant_id uuid not null references pharmacy.tenants (id),
  store_id uuid not null,
  product_id uuid not null,
  retail_price_per_pack_dirams bigint check (retail_price_per_pack_dirams > 0),
  retail_price_per_piece_dirams bigint check (retail_price_per_piece_dirams > 0),
  price_version integer not null default 1 check (price_version >= 1),
  price_changed_at timestamptz,
  price_changed_by uuid,
  price_source text not null default 'cloud' check (price_source in ('cloud', 'store')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, store_id, product_id),
  foreign key (tenant_id, store_id) references pharmacy.stores (tenant_id, id),
  foreign key (tenant_id, product_id) references pharmacy.products (tenant_id, id),
  foreign key (tenant_id, price_changed_by) references pharmacy.employees (tenant_id, id)
);
create index store_products_product_idx on pharmacy.store_products (tenant_id, product_id);
create index store_products_changed_by_idx on pharmacy.store_products (tenant_id, price_changed_by);

-- discount_rules - thresholds by the receipt subtotal; the single most favourable rule applies.
create table pharmacy.discount_rules (
  tenant_id uuid not null references pharmacy.tenants (id),
  id uuid not null,
  name jsonb not null check (jsonb_typeof(name) = 'object' and name <> '{}'::jsonb),
  level text not null check (level in ('network', 'store')),
  store_scope text not null check (store_scope in ('all', 'list')),
  valid_from date,
  valid_to date,
  status text not null default 'active' check (status in ('active', 'archived')),
  archived_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, created_by) references pharmacy.employees (tenant_id, id),
  check ((level = 'network') = (store_scope = 'all')),
  check (valid_to is null or (valid_from is not null and valid_to >= valid_from)),
  check (status <> 'archived' or archived_at is not null)
);
create index discount_rules_created_by_idx on pharmacy.discount_rules (tenant_id, created_by);

create table pharmacy.discount_rule_tiers (
  tenant_id uuid not null references pharmacy.tenants (id),
  rule_id uuid not null,
  min_total_dirams bigint not null check (min_total_dirams > 0),
  percent_bp integer not null check (percent_bp between 100 and 10000),
  created_at timestamptz not null default now(),
  primary key (tenant_id, rule_id, min_total_dirams),
  foreign key (tenant_id, rule_id) references pharmacy.discount_rules (tenant_id, id)
);

create table pharmacy.discount_rule_stores (
  tenant_id uuid not null references pharmacy.tenants (id),
  rule_id uuid not null,
  store_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, rule_id, store_id),
  foreign key (tenant_id, rule_id) references pharmacy.discount_rules (tenant_id, id),
  foreign key (tenant_id, store_id) references pharmacy.stores (tenant_id, id)
);
create index discount_rule_stores_store_idx on pharmacy.discount_rule_stores (tenant_id, store_id);

-- Isolation and grants (ADR-0013): fail-closed tenant filter for pharmacy_app, full DML as on every
-- tenant table (the application archives instead of deleting catalog rows).
alter table pharmacy.categories enable row level security;
alter table pharmacy.categories force row level security;
alter table pharmacy.dictionary_values enable row level security;
alter table pharmacy.dictionary_values force row level security;
alter table pharmacy.products enable row level security;
alter table pharmacy.products force row level security;
alter table pharmacy.product_barcodes enable row level security;
alter table pharmacy.product_barcodes force row level security;
alter table pharmacy.store_products enable row level security;
alter table pharmacy.store_products force row level security;
alter table pharmacy.discount_rules enable row level security;
alter table pharmacy.discount_rules force row level security;
alter table pharmacy.discount_rule_tiers enable row level security;
alter table pharmacy.discount_rule_tiers force row level security;
alter table pharmacy.discount_rule_stores enable row level security;
alter table pharmacy.discount_rule_stores force row level security;

create policy tenant_isolation on pharmacy.categories for all to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));
create policy tenant_isolation on pharmacy.dictionary_values for all to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));
create policy tenant_isolation on pharmacy.products for all to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));
create policy tenant_isolation on pharmacy.product_barcodes for all to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));
create policy tenant_isolation on pharmacy.store_products for all to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));
create policy tenant_isolation on pharmacy.discount_rules for all to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));
create policy tenant_isolation on pharmacy.discount_rule_tiers for all to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));
create policy tenant_isolation on pharmacy.discount_rule_stores for all to pharmacy_app
  using (tenant_id = (select current_setting('app.tenant_id')::uuid))
  with check (tenant_id = (select current_setting('app.tenant_id')::uuid));

grant select, insert, update, delete on
  pharmacy.categories,
  pharmacy.dictionary_values,
  pharmacy.products,
  pharmacy.product_barcodes,
  pharmacy.store_products,
  pharmacy.discount_rules,
  pharmacy.discount_rule_tiers,
  pharmacy.discount_rule_stores
to pharmacy_app;

-- Starter catalog of a new network (spec, section 4; ADR-0013, amendment 2026-10-05, p. 6):
-- provision_tenant also creates the starter categories and the system dosage forms. The
-- application passes them (catalogDefaults of libs/shared/domain) as one jsonb object.
drop function pharmacy.provision_tenant(uuid, text, text, text, text, uuid, uuid, jsonb, text, text, text, text, text, timestamptz, jsonb);

grant insert on pharmacy.categories, pharmacy.dictionary_values to pharmacy_provisioner;
-- The backfill below finds networks without categories.
grant select (tenant_id) on pharmacy.categories to pharmacy_provisioner;
create policy provisioner_all on pharmacy.categories for all to pharmacy_provisioner
  using (true) with check (true);
create policy provisioner_all on pharmacy.dictionary_values for all to pharmacy_provisioner
  using (true) with check (true);

create function pharmacy.provision_tenant(
  p_tenant_id uuid,
  p_code text,
  p_name text,
  p_city text,
  p_inn text,
  p_owner_employee_id uuid,
  p_owner_role_id uuid,
  p_owner_role_name jsonb,
  p_owner_full_name text,
  p_owner_login text,
  p_owner_phone text,
  p_owner_email text,
  p_code_hash text,
  p_code_expires_at timestamptz,
  p_default_roles jsonb,
  p_catalog_defaults jsonb
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_role jsonb;
  v_item jsonb;
  v_order integer;
begin
  if jsonb_typeof(p_default_roles) is distinct from 'array' then
    raise exception 'p_default_roles must be a json array' using errcode = '22023';
  end if;
  if jsonb_typeof(p_catalog_defaults) is distinct from 'object'
     or jsonb_typeof(p_catalog_defaults -> 'categories') is distinct from 'array'
     or jsonb_typeof(p_catalog_defaults -> 'dosageForms') is distinct from 'array' then
    raise exception 'p_catalog_defaults needs categories and dosageForms arrays' using errcode = '22023';
  end if;

  insert into pharmacy.tenants
    (id, code, name, city, billing_tax_id, owner_full_name, owner_login, owner_phone, owner_email)
  values
    (p_tenant_id, p_code, p_name, p_city, p_inn, p_owner_full_name, lower(p_owner_login),
     p_owner_phone, lower(p_owner_email));

  insert into pharmacy.tenant_settings (tenant_id) values (p_tenant_id);

  insert into pharmacy.roles (tenant_id, id, name, is_owner, template_key)
  values (p_tenant_id, p_owner_role_id, p_owner_role_name, true, 'owner');

  for v_role in select * from jsonb_array_elements(p_default_roles) loop
    if jsonb_typeof(v_role -> 'name') is distinct from 'object'
       or jsonb_typeof(v_role -> 'permissions') is distinct from 'array'
       or (v_role ->> 'id') is null then
      raise exception 'a default role needs id, name and permissions' using errcode = '22023';
    end if;
    insert into pharmacy.roles (tenant_id, id, name, is_owner, template_key)
    values (p_tenant_id, (v_role ->> 'id')::uuid, v_role -> 'name', false, null);
    insert into pharmacy.role_permissions (tenant_id, role_id, permission)
    select p_tenant_id, (v_role ->> 'id')::uuid, p.permission
    from jsonb_array_elements_text(v_role -> 'permissions') as p(permission);
  end loop;

  for v_item, v_order in
    select e.value, e.ordinality::integer
    from jsonb_array_elements(p_catalog_defaults -> 'categories') with ordinality as e
  loop
    if (v_item ->> 'id') is null or jsonb_typeof(v_item -> 'name') is distinct from 'object' then
      raise exception 'a starter category needs id and name' using errcode = '22023';
    end if;
    insert into pharmacy.categories (tenant_id, id, name, pos_sort_order)
    values (p_tenant_id, (v_item ->> 'id')::uuid, v_item -> 'name', v_order);
  end loop;

  for v_item in select * from jsonb_array_elements(p_catalog_defaults -> 'dosageForms') loop
    if (v_item ->> 'id') is null or (v_item ->> 'code') is null
       or jsonb_typeof(v_item -> 'name') is distinct from 'object' then
      raise exception 'a dosage form needs id, code and name' using errcode = '22023';
    end if;
    insert into pharmacy.dictionary_values (tenant_id, id, kind, code, name, is_system)
    values (p_tenant_id, (v_item ->> 'id')::uuid, 'dosage_form', v_item ->> 'code', v_item -> 'name', true);
  end loop;

  insert into pharmacy.employees
    (tenant_id, id, role_id, login, full_name, phone, email, store_scope)
  values
    (p_tenant_id, p_owner_employee_id, p_owner_role_id, lower(p_owner_login), p_owner_full_name,
     p_owner_phone, lower(p_owner_email), 'all');

  insert into pharmacy.employee_credentials
    (tenant_id, employee_id, one_time_code_hash, one_time_code_expires_at)
  values (p_tenant_id, p_owner_employee_id, p_code_hash, p_code_expires_at);
end;
$$;
alter function pharmacy.provision_tenant(uuid, text, text, text, text, uuid, uuid, jsonb, text, text, text, text, text, timestamptz, jsonb, jsonb)
  owner to pharmacy_provisioner;
revoke all on function pharmacy.provision_tenant(uuid, text, text, text, text, uuid, uuid, jsonb, text, text, text, text, text, timestamptz, jsonb, jsonb)
  from public;
grant execute on function pharmacy.provision_tenant(uuid, text, text, text, text, uuid, uuid, jsonb, text, text, text, text, text, timestamptz, jsonb, jsonb)
  to pharmacy_platform;

-- Networks created before this migration get the starter catalog once, under pharmacy_provisioner
-- (the owner of the database is its member). One-time copy of catalogDefaults
-- (libs/shared/domain), 2026-10-07.
set local role pharmacy_provisioner;
do $$
declare
  v_tenant uuid;
begin
  for v_tenant in
    select t.id from pharmacy.tenants t
    where not exists (select 1 from pharmacy.categories c where c.tenant_id = t.id)
  loop
    insert into pharmacy.categories (tenant_id, id, name, pos_sort_order)
    select v_tenant, gen_random_uuid(), d.name, d.ord
    from (values
      ('{"ru": "Лекарственные средства", "tj": "Маводи доруворӣ"}'::jsonb, 1),
      ('{"ru": "Витамины и БАД", "tj": "Витаминҳо ва иловаҳои ғизоӣ"}'::jsonb, 2),
      ('{"ru": "Медицинские изделия", "tj": "Маснуоти тиббӣ"}'::jsonb, 3),
      ('{"ru": "Гигиена и уход", "tj": "Гигиена ва нигоҳубин"}'::jsonb, 4),
      ('{"ru": "Детские товары", "tj": "Молҳои кӯдакона"}'::jsonb, 5),
      ('{"ru": "Прочее", "tj": "Дигар"}'::jsonb, 6)
    ) as d(name, ord);

    insert into pharmacy.dictionary_values (tenant_id, id, kind, code, name, is_system)
    select v_tenant, gen_random_uuid(), 'dosage_form', d.code, d.name, true
    from (values
      ('tablets', '{"ru": "Таблетки", "tj": "Ҳабҳо"}'::jsonb),
      ('capsules', '{"ru": "Капсулы", "tj": "Капсулаҳо"}'::jsonb),
      ('syrup', '{"ru": "Сироп", "tj": "Шарбат"}'::jsonb),
      ('suspension', '{"ru": "Суспензия", "tj": "Суспензия"}'::jsonb),
      ('solution', '{"ru": "Раствор", "tj": "Маҳлул"}'::jsonb),
      ('ointment', '{"ru": "Мазь", "tj": "Марҳам"}'::jsonb),
      ('cream', '{"ru": "Крем", "tj": "Крем"}'::jsonb),
      ('gel', '{"ru": "Гель", "tj": "Гел"}'::jsonb),
      ('drops', '{"ru": "Капли", "tj": "Қатраҳо"}'::jsonb),
      ('spray', '{"ru": "Спрей", "tj": "Спрей"}'::jsonb),
      ('powder', '{"ru": "Порошок", "tj": "Хока"}'::jsonb),
      ('suppositories', '{"ru": "Суппозитории", "tj": "Шамъчаҳо"}'::jsonb),
      ('ampoules', '{"ru": "Ампулы", "tj": "Ампулаҳо"}'::jsonb)
    ) as d(code, name);
  end loop;
end;
$$;
reset role;
