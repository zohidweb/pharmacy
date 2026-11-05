-- A synthetic year of the network «Нагрузка» for the POS load run (ADR-0009, axis Ж; plan
-- docs/superpowers/plans/2026-11-04-pos-load-test.md, task 2). Run only by tools/load/db.mjs, as the superuser of the
-- dev container, only in pharmacy_load, one phase per psql call in a single transaction (psql -1):
--
--   phase=setup   partitions back to the start of the history, the network and its reference data, helper tables
--   phase=month   the receipts, lines, payments, sale movements, audit and shifts of one month (:month)
--   phase=finish  deliveries (documents, lines, batches, receipt movements), counters, idempotency keys, statistics
--
-- session_replication_role = replica switches off the FK triggers of this session only (plan R4); the superuser
-- bypasses RLS. `verify` checks the references afterwards. Every random choice is a hash of its position
-- (load_gen.u), so a new run on the same scale gives the same counts. The data is synthetic.
\set ON_ERROR_STOP on
set session_replication_role = replica;
set search_path = pharmacy, public;
set timezone = 'UTC';

select :'phase' = 'setup' as is_setup, :'phase' = 'month' as is_month, :'phase' = 'finish' as is_finish \gset

\if :is_setup
create schema load_gen;

-- A uniform number in [0, 1) of a position: the same inputs, the same number, in any order of evaluation.
create function load_gen.u(a bigint, b bigint) returns float8 language sql immutable parallel safe
return (hashint8extended(a, b) & 4503599627370495)::float8 / 4503599627370496;

-- A UUIDv7 of a moment, the other bits from the md5 of a salt: ordered in time like the ids of the API.
create function load_gen.uuid7(ts timestamptz, salt text) returns uuid language sql stable parallel safe
begin atomic
  select encode(
    substring(int8send(floor(extract(epoch from ts) * 1000)::bigint) from 3 for 6)
      || set_byte(set_byte(substring(h from 7 for 10), 0, (get_byte(h, 6) & 15) | 112), 2, (get_byte(h, 8) & 63) | 128),
    'hex')::uuid
  from (select decode(md5(salt), 'hex') as h) x;
end;

-- EAN-13: twelve digits and the check digit.
create function load_gen.ean13(body text) returns text language sql immutable parallel safe
begin atomic
  select body || ((10 - sum(substr(body, i, 1)::int * case when i % 2 = 1 then 1 else 3 end) % 10) % 10)::text
  from generate_series(1, 12) i;
end;

create table load_gen.meta (key text primary key, value text not null);
create table load_gen.month (month_start date primary key, receipts bigint not null, loaded_at timestamptz not null);
create table load_gen.counter (store_no int, year int, last bigint not null, primary key (store_no, year));

-- partitions of the history, by the pattern of the migrations (plan R3): only in this database
select format('create table if not exists pharmacy.%I partition of pharmacy.%I for values from (%L) to (%L)',
              t || '_' || to_char(m, 'YYYY_MM'), t,
              to_char(m, 'YYYY-MM-DD') || ' 00:00:00+00', to_char(m + interval '1 month', 'YYYY-MM-DD') || ' 00:00:00+00')
from unnest(array['stock_movements', 'audit_log']) t,
     generate_series(date_trunc('month', :'history_from'::date - 31), date_trunc('month', :'today'::date), interval '1 month') m
where to_regclass(format('pharmacy.%I', t || '_' || to_char(m, 'YYYY_MM'))) is null
\gexec
select format('alter table pharmacy.%I owner to pharmacy_owner', c.relname)
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'pharmacy' and c.relkind = 'r' and c.relispartition and pg_get_userbyid(c.relowner) <> 'pharmacy_owner'
\gexec

insert into load_gen.meta values
  ('tenant_id', :'tenant_id'), ('owner_id', :'owner_id'), ('scale', :'scale'),
  ('history_from', :'history_from'), ('today', :'today'), ('started_at', now()::text);

-- the network, as the platform creates it: the owner role, the role templates, the starter catalog, the owner code
select pharmacy.provision_tenant(
  :'tenant_id'::uuid, 'load', 'Нагрузка', 'Душанбе', '900000001',
  :'owner_id'::uuid, :'owner_role_id'::uuid, '{"ru": "Владелец", "tj": "Соҳиб"}'::jsonb,
  'Владелец сети «Нагрузка»', 'load.owner', null, null,
  :'owner_code_hash', now() + interval '30 days', :'roles'::jsonb, :'catalog'::jsonb);

select (:'history_from'::date - 30)::timestamptz as old_ts \gset

insert into pharmacy.legal_entities (tenant_id, id, name, tax_id, legal_address, created_at, updated_at)
values (:'tenant_id', load_gen.uuid7(:'old_ts'::timestamptz, 'legal'), 'ООО «Нагрузка»', '900000002', 'г. Душанбе, ул. Нагрузочная, 1',
        :'old_ts'::timestamptz, :'old_ts'::timestamptz);

create table load_gen.store as
select n as no, load_gen.uuid7(:'old_ts'::timestamptz, 'store:' || n) as id, 'L' || lpad(n::text, 2, '0') as code
from generate_series(1, 30) n;
alter table load_gen.store add primary key (no);

insert into pharmacy.stores (tenant_id, id, legal_entity_id, name, code, address, kind, mode, created_at, updated_at)
select :'tenant_id', s.id, load_gen.uuid7(:'old_ts'::timestamptz, 'legal'), 'Аптека № ' || s.no, s.code,
       'г. Душанбе, ул. Нагрузочная, ' || (s.no + 1), 'pharmacy', 'online', :'old_ts'::timestamptz, :'old_ts'::timestamptz
from load_gen.store s;

create table load_gen.supplier as
select n as no, load_gen.uuid7(:'old_ts'::timestamptz, 'supplier:' || n) as id from generate_series(1, 10) n;
insert into pharmacy.suppliers (tenant_id, id, name, tax_id, payment_term_days, created_at, updated_at)
select :'tenant_id', id, 'Поставщик нагрузки ' || lpad(no::text, 2, '0'), '91000000' || (no - 1), 14,
       :'old_ts'::timestamptz, :'old_ts'::timestamptz
from load_gen.supplier;

insert into pharmacy.categories (tenant_id, id, name, pos_sort_order, created_at, updated_at)
select :'tenant_id', load_gen.uuid7(:'old_ts'::timestamptz, 'category:' || n),
       jsonb_build_object('ru', 'Группа ' || n, 'tj', 'Гурӯҳи ' || n), 100 + n, :'old_ts'::timestamptz, :'old_ts'::timestamptz
from generate_series(1, 20) n;

-- products: МНН × form × dosage, RU and TJ names, a barcode 290… (10 % a second one 291…)
create table load_gen.product as
with inn(i, ru, tj) as (
  select i, ru, tj from unnest(
    array['Парацетамол', 'Ибупрофен', 'Амоксициллин', 'Азитромицин', 'Цефтриаксон', 'Метформин', 'Амлодипин',
          'Лозартан', 'Эналаприл', 'Бисопролол', 'Аторвастатин', 'Омепразол', 'Пантопразол', 'Дротаверин',
          'Лоратадин', 'Цетиризин', 'Метронидазол', 'Ципрофлоксацин', 'Диклофенак', 'Кеторолак', 'Нимесулид',
          'Аскорбиновая кислота', 'Ацетилцистеин', 'Амброксол', 'Бромгексин', 'Флуконазол', 'Ацикловир', 'Валсартан',
          'Гидрохлоротиазид', 'Фуросемид', 'Спиронолактон', 'Кларитромицин', 'Доксициклин', 'Левофлоксацин',
          'Мелоксикам', 'Карбамазепин', 'Вальпроевая кислота', 'Сертралин', 'Флуоксетин', 'Диазепам', 'Трамадол',
          'Фенобарбитал', 'Преднизолон', 'Дексаметазон', 'Гидрокортизон', 'Левотироксин', 'Инсулин гларгин',
          'Глибенкламид', 'Гликлазид', 'Варфарин', 'Клопидогрел', 'Ацетилсалициловая кислота', 'Нитроглицерин',
          'Метопролол', 'Каптоприл', 'Лизиноприл', 'Симвастатин', 'Ранитидин', 'Фамотидин', 'Лоперамид'],
    array['Парасетамол', 'Ибупрофен', 'Амоксисиллин', 'Азитромитсин', 'Сефтриаксон', 'Метформин', 'Амлодипин',
          'Лозартан', 'Эналаприл', 'Бисопролол', 'Аторвастатин', 'Омепразол', 'Пантопразол', 'Дротаверин',
          'Лоратадин', 'Сетиризин', 'Метронидазол', 'Сипрофлоксасин', 'Диклофенак', 'Кеторолак', 'Нимесулид',
          'Кислотаи аскорбинӣ', 'Атсетилсистеин', 'Амброксол', 'Бромгексин', 'Флуконазол', 'Атсикловир', 'Валсартан',
          'Гидрохлоротиазид', 'Фуросемид', 'Спиронолактон', 'Кларитромитсин', 'Доксисиклин', 'Левофлоксасин',
          'Мелоксикам', 'Карбамазепин', 'Кислотаи валпроӣ', 'Сертралин', 'Флуоксетин', 'Диазепам', 'Трамадол',
          'Фенобарбитал', 'Преднизолон', 'Дексаметазон', 'Гидрокортизон', 'Левотироксин', 'Инсулини гларгин',
          'Глибенкламид', 'Гликлазид', 'Варфарин', 'Клопидогрел', 'Кислотаи атсетилсалитсилӣ', 'Нитроглитсерин',
          'Метопролол', 'Каптоприл', 'Лизиноприл', 'Симвастатин', 'Ранитидин', 'Фамотидин', 'Лоперамид'])
    with ordinality as x(ru, tj, i)
), form(f, code, ru, tj, pieces, dose) as (
  values (1, 'tablets', 'таблетки', 'ҳабҳо', 20, 'мг'), (2, 'capsules', 'капсулы', 'капсулаҳо', 10, 'мг'),
         (3, 'syrup', 'сироп', 'шарбат', 1, 'мл'), (4, 'suspension', 'суспензия', 'суспензия', 1, 'мл'),
         (5, 'solution', 'раствор', 'маҳлул', 1, 'мл'), (6, 'ointment', 'мазь', 'марҳам', 1, 'г'),
         (7, 'cream', 'крем', 'крем', 1, 'г'), (8, 'gel', 'гель', 'гел', 1, 'г'), (9, 'drops', 'капли', 'қатраҳо', 1, 'мл'),
         (10, 'spray', 'спрей', 'спрей', 1, 'мл'), (11, 'powder', 'порошок', 'хока', 10, 'г'),
         (12, 'suppositories', 'суппозитории', 'шамъчаҳо', 10, 'мг'), (13, 'ampoules', 'ампулы', 'ампулаҳо', 5, 'мг')
), maker(m, name, country) as (
  values (0, 'Фармстандарт', 'RU'), (1, 'Тева', 'IL'), (2, 'КРКА', 'SI'), (3, 'Сандоз', 'DE'), (4, 'Д-р Редди''с', 'IN'),
         (5, 'Абди Ибрахим', 'TR'), (6, 'Нобел', 'KZ'), (7, 'Фармакор', 'BY'), (8, 'Душанбе Фарм', 'TJ'), (9, 'Синофарм', 'CN')
), numbered as (
  select n, inn.ru as inn_ru, inn.tj as inn_tj, inn.i as inn_i, form.*,
         (array[5, 10, 25, 50, 100, 250, 500, 1000])[1 + (n * 7) % 8] as amount,
         maker.name as maker, maker.country
  from generate_series(1, 3000) n
  join inn on inn.i = 1 + (n - 1) % 60
  join form on form.f = 1 + ((n - 1) / 60) % 13
  join maker on maker.m = (n * 3) % 10
)
select n as no, load_gen.uuid7(:'old_ts'::timestamptz, 'product:' || n) as id,
       inn_ru, inn_tj, code as form_code, maker, country,
       format('%s %s %s %s%s', inn_ru, ru, amount, dose, case when pieces > 1 then ' №' || pieces else '' end) as name_ru,
       format('%s %s %s %s%s', inn_tj, tj, amount, dose, case when pieces > 1 then ' №' || pieces else '' end) as name_tj,
       amount || ' ' || dose as dosage, pieces,
       pieces > 1 and load_gen.u(n, 1) < 0.2 as by_piece,
       inn_i in (40, 41, 42) and load_gen.u(n, 2) < 0.25 as controlled,
       load_gen.u(n, 3) < 0.15 as prescription_only,
       (ceil((300 + floor(power(load_gen.u(n, 4), 3) * 80000)) / 10) * 10)::bigint as price_pack,
       1 + (n * 7) % 10 as supplier_no,
       1 + (n * 11) % 26 as category_no,
       load_gen.ean13('290' || lpad(n::text, 9, '0')) as barcode,
       case when load_gen.u(n, 5) < 0.1 then load_gen.ean13('291' || lpad(n::text, 9, '0')) end as barcode2
from numbered;
alter table load_gen.product add primary key (no);
-- the popularity rank: OTC products first, so the most popular one (the hot product of the run) needs no prescription
alter table load_gen.product add column rank int;
update load_gen.product p set rank = o.rank
from (select no, row_number() over (order by controlled or prescription_only, load_gen.u(no, 6), no) as rank
      from load_gen.product) o
where o.no = p.no;
alter table load_gen.product add column purchase_pack bigint, add column cost_piece bigint;
update load_gen.product set purchase_pack = floor(price_pack / 1.3 / 10) * 10;
update load_gen.product set cost_piece = ceil(purchase_pack::numeric / pieces);

insert into pharmacy.products
  (tenant_id, id, name, inn, dosage_form, dosage, manufacturer, country, unit, pieces_per_pack, sold_by_piece,
   is_prescription, is_controlled, category_id, status, created_at, updated_at)
select :'tenant_id', p.id, jsonb_build_object('ru', p.name_ru, 'tj', p.name_tj),
       jsonb_build_object('ru', p.inn_ru, 'tj', p.inn_tj), p.form_code, p.dosage, p.maker, p.country, 'pack', p.pieces,
       p.by_piece, p.controlled or p.prescription_only, p.controlled, c.id, 'active', :'old_ts'::timestamptz, :'old_ts'::timestamptz
from load_gen.product p
join (select id, row_number() over (order by pos_sort_order, id) as no
      from pharmacy.categories where tenant_id = :'tenant_id') c on c.no = p.category_no;

insert into pharmacy.product_barcodes (tenant_id, barcode, product_id, created_at)
select :'tenant_id', b, p.id, :'old_ts'::timestamptz
from load_gen.product p, unnest(array[p.barcode, p.barcode2]) b
where b is not null;

insert into pharmacy.store_products
  (tenant_id, store_id, product_id, retail_price_per_pack_dirams, price_version, price_changed_at, created_at, updated_at)
select :'tenant_id', s.id, p.id, p.price_pack, 1, :'old_ts'::timestamptz, :'old_ts'::timestamptz, :'old_ts'::timestamptz
from load_gen.store s cross join load_gen.product p;

-- 250 cashiers, 8 or 9 per store, without a password or a PIN: the fleet of the run sets the PIN (task 3)
create table load_gen.cashier as
select n, 1 + (n - 1) % 30 as store_no, load_gen.uuid7(:'old_ts'::timestamptz, 'cashier:' || n) as id,
       (row_number() over (partition by 1 + (n - 1) % 30 order by n) - 1)::int as idx
from generate_series(1, 250) n;
alter table load_gen.cashier add primary key (store_no, idx);
alter table load_gen.store add column cashiers int;
update load_gen.store s set cashiers = (select count(*) from load_gen.cashier c where c.store_no = s.no);

insert into pharmacy.employees
  (tenant_id, id, role_id, login, full_name, language, store_scope, created_at, updated_at)
select :'tenant_id', c.id,
       (select r.id from pharmacy.roles r where r.tenant_id = :'tenant_id' and r.name ->> 'ru' = 'Фармацевт-кассир'),
       'load.cashier.' || lpad(c.n::text, 3, '0'), 'Кассир ' || lpad(c.n::text, 3, '0'), 'ru', 'list', :'old_ts'::timestamptz, :'old_ts'::timestamptz
from load_gen.cashier c;
insert into pharmacy.employee_stores (tenant_id, employee_id, store_id, created_at)
select :'tenant_id', c.id, s.id, :'old_ts'::timestamptz from load_gen.cashier c join load_gen.store s on s.no = c.store_no;

-- the terminals of the year, three per store, revoked before the run: the fleet binds its own
create table load_gen.terminal as
select s.no as store_no, t as no, load_gen.uuid7(:'old_ts'::timestamptz, 'terminal:' || s.no || ':' || t) as id
from load_gen.store s, generate_series(1, 3) t;
insert into pharmacy.terminals
  (tenant_id, id, store_id, name, credential_hash, bound_by, bound_at, revoked_at, revoked_by, created_at)
select :'tenant_id', t.id, s.id, 'Касса ' || t.no || ' (год нагрузки)',
       sha256(convert_to('load-terminal:' || t.id, 'UTF8')), :'owner_id', :'old_ts'::timestamptz, now(), :'owner_id', :'old_ts'::timestamptz
from load_gen.terminal t join load_gen.store s on s.no = t.store_no;

-- the deliveries of a product at a store: k batches a year (2–4), the periods shifted by up to 13 days
create table load_gen.sp as
select s.no as store_no, p.no as product_no,
       2 + floor(load_gen.u(s.no * 10000 + p.no, 11) * 3)::int as k,
       floor(load_gen.u(s.no * 10000 + p.no, 12) * 14)::int as j
from load_gen.store s cross join load_gen.product p;
alter table load_gen.sp add primary key (store_no, product_no);

create table load_gen.batch as
select sp.store_no, sp.product_no, i as period, sp.k,
       case when i = 0 then :'history_from'::date - 1
            else :'history_from'::date + floor(365 * i / sp.k::numeric)::int - sp.j - 1 end as delivered_on
from load_gen.sp, generate_series(0, 3) i
where i < sp.k;
alter table load_gen.batch add column batch_id uuid, add column doc_id uuid, add column supplier_no int;
update load_gen.batch b set
  batch_id = load_gen.uuid7((b.delivered_on + time '10:00') at time zone 'Asia/Dushanbe',
                            'batch:' || b.store_no || ':' || b.product_no || ':' || b.period),
  supplier_no = p.supplier_no,
  doc_id = load_gen.uuid7((b.delivered_on + time '10:00') at time zone 'Asia/Dushanbe',
                          'doc:' || b.store_no || ':' || b.delivered_on || ':' || p.supplier_no)
from load_gen.product p where p.no = b.product_no;
alter table load_gen.batch add primary key (store_no, product_no, period);

-- the popularity of products (Zipf, s = 1) as 100 000 slots: a hash picks a slot, the slot a product; ПКУ products are
-- not in the history (no prescription records), they keep their deliveries
create table load_gen.zipf_slot as
with c as (
  select no, sum(1.0 / rank) over (order by rank) / sum(1.0 / rank) over () as hi
  from load_gen.product where not controlled
), r as (
  select no, coalesce(lag(hi) over (order by hi), 0) as lo, hi from c
)
select slot, r.no as product_no
from r, generate_series(floor(r.lo * 100000)::int, floor(r.hi * 100000)::int - 1) slot;
alter table load_gen.zipf_slot add primary key (slot);
do $$
begin
  if (select count(*) from load_gen.zipf_slot) <> 100000 then
    raise exception 'the popularity slots do not tile 0..99999';
  end if;
end $$;
-- the months join these tables: without statistics the first month plans its joins blind
analyze load_gen.store, load_gen.product, load_gen.cashier, load_gen.terminal, load_gen.supplier, load_gen.sp,
        load_gen.batch, load_gen.zipf_slot;

\echo setup done
\endif

\if :is_month
select value as tenant_id from load_gen.meta where key = 'tenant_id' \gset

create temp table d on commit drop as
select day::date as day, day::date - :'history_from'::date as x
from generate_series(greatest(:'month'::date, :'history_from'::date),
                     least((:'month'::date + interval '1 month')::date - 1, :'today'::date - 1), interval '1 day') day;

-- 500 × scale receipts a store a day (± 30 %), sold from 08:00 to 21:00 in Dushanbe, round the three terminals
create temp table r on commit drop as
with base as (
  select s.no as store_no, s.id as store_id, s.code, s.cashiers, d.day, d.x, k,
         (s.no::bigint * 1000000 + d.x) * 10000 + k as seed
  from load_gen.store s cross join d
  cross join lateral generate_series(1, greatest(1, round(500 * :scale * (0.7 + 0.6 * load_gen.u(s.no * 1000 + d.x, 1))))::int) k
), timed as (
  select b.*, 1 + b.k % 3 as terminal_no,
         ((b.day + time '08:00') + load_gen.u(b.seed, 2) * interval '13 hours') at time zone 'Asia/Dushanbe' as sold_at
  from base b
)
select b.*, load_gen.uuid7(b.sold_at, 'receipt:' || b.seed) as id,
       b.sold_at + (1 + load_gen.u(b.seed, 6) * 2) * interval '1 second' as received_at,
       load_gen.uuid7((b.day + time '07:50') at time zone 'Asia/Dushanbe',
                      'shift:' || b.store_no || ':' || b.terminal_no || ':' || b.day) as shift_id,
       tm.id as terminal_id, c.id as cashier_id,
       case when load_gen.u(b.seed, 3) < 0.45 then 1 when load_gen.u(b.seed, 3) < 0.80 then 2 else 3 end as line_count,
       load_gen.u(b.seed, 4) < 0.6 as cash,
       case when load_gen.u(b.seed, 5) < 0.85 then 'ru' else 'tj' end as language
from timed b
join load_gen.terminal tm on tm.store_no = b.store_no and tm.no = b.terminal_no
join load_gen.cashier c on c.store_no = b.store_no and c.idx = (b.terminal_no - 1 + b.x) % b.cashiers;
analyze r;

-- 1–3 lines (1.75 on average), the product by its popularity, the batch of its delivery period at the store
create temp table l on commit drop as
select r.id as receipt_id, r.store_no, r.store_id, r.day, r.x, r.received_at, r.seed, n as line_no,
       p.no as product_no, p.id as product_id, p.pieces, p.price_pack, p.cost_piece, b.batch_id,
       case when load_gen.u(r.seed, 40 + n) < 0.8 then 1 else 2 end as packs,
       load_gen.uuid7(r.sold_at, 'line:' || r.seed || ':' || n) as id
from r cross join generate_series(1, r.line_count) n
join load_gen.zipf_slot z on z.slot = floor(load_gen.u(r.seed, 20 + n) * 100000)::int
join load_gen.product p on p.no = z.product_no
join load_gen.sp sp on sp.store_no = r.store_no and sp.product_no = p.no
join load_gen.batch b on b.store_no = r.store_no and b.product_no = p.no
  and b.period = least(sp.k - 1, ceil((r.x + sp.j + 1) * sp.k / 365.0)::int - 1);
analyze l;

create temp table t on commit drop as
select r.*, s.subtotal,
       case when r.cash then ceil(s.subtotal / 1000.0)::bigint * 1000 else 0 end as tendered
from r join (select receipt_id, sum(packs * price_pack)::bigint as subtotal from l group by receipt_id) s
  on s.receipt_id = r.id;
alter table t add column number text, add column year int;
update t set year = extract(year from day)::int;
with n as (
  select t.id, coalesce(c.last, 0) + row_number() over (partition by t.store_no, t.year order by t.sold_at, t.id) as n
  from t left join load_gen.counter c on c.store_no = t.store_no and c.year = t.year
)
update t set number = 'ЧК-' || t.code || '-' || t.year || '-' || lpad(n.n::text, 6, '0') from n where n.id = t.id;
insert into load_gen.counter (store_no, year, last)
select store_no, year, max(substring(number from '\d+$')::bigint) from t group by store_no, year
on conflict (store_no, year) do update set last = excluded.last;

insert into pharmacy.receipts
  (tenant_id, id, store_id, terminal_id, shift_id, cashier_id, number, sold_at, received_at, business_date,
   subtotal_dirams, total_dirams, cash_tendered_dirams, change_dirams, correlation_id, origin, language, created_at)
select :'tenant_id', id, store_id, terminal_id, shift_id, cashier_id, number, sold_at, received_at, day,
       subtotal, subtotal, tendered, case when cash then tendered - subtotal else 0 end, id::text, 'online', language,
       received_at
from t;

insert into pharmacy.receipt_lines
  (tenant_id, id, receipt_id, line_no, product_id, batch_id, sale_unit, pieces_per_pack, qty_pieces, unit_price_dirams,
   line_amount_dirams, cost_dirams, created_at)
select :'tenant_id', id, receipt_id, line_no, product_id, batch_id, 'pack', pieces, packs * pieces, price_pack,
       packs * price_pack, packs * pieces * cost_piece, received_at
from l;

-- Σ payments = total + change: the cash line holds what was handed over (E10)
insert into pharmacy.payments (tenant_id, id, receipt_id, kind, amount_dirams, created_at)
select :'tenant_id', load_gen.uuid7(sold_at, 'payment:' || seed), id,
       case when cash then 'cash' else 'card' end, case when cash then tendered else subtotal end, received_at
from t;

insert into pharmacy.stock_movements
  (tenant_id, id, recorded_at, store_id, batch_id, qty_delta_pieces, kind, source_type, source_id, source_line_id,
   business_date, origin)
select :'tenant_id', load_gen.uuid7(received_at, 'sale:' || seed || ':' || line_no), received_at, store_id, batch_id,
       -(packs * pieces), 'sale', 'receipt', receipt_id, id, day, 'local'
from l;

insert into pharmacy.audit_log
  (tenant_id, id, recorded_at, business_date, employee_id, store_id, terminal_id, correlation_id, action, entity_type,
   entity_id, details, source)
select :'tenant_id', load_gen.uuid7(received_at, 'audit:' || seed), received_at, day, cashier_id, store_id, terminal_id,
       id::text, 'receipt.completed', 'receipt', id,
       jsonb_build_object('via', 'terminal', 'number', number, 'localNumber', null, 'shiftId', shift_id,
                          'authorId', cashier_id, 'totalMinor', subtotal, 'discrepancyKinds', '[]'::jsonb),
       'cloud'
from t;

-- one closed shift a day on each terminal, with the Z-report of its receipts
insert into pharmacy.shifts
  (tenant_id, id, store_id, terminal_id, number, status, opened_by, opened_at, received_at, opening_cash_dirams,
   closed_by, closed_at, expected_cash_dirams, counted_cash_dirams, discrepancy_dirams, terminal_totals, z_report,
   created_at)
select :'tenant_id', g.shift_id, g.store_id, g.terminal_id, g.number, 'closed', g.cashier_id, g.opened_at, g.opened_at,
       50000, g.cashier_id, g.closed_at, 50000 + g.cash_minor, 50000 + g.cash_minor, 0,
       jsonb_build_object('card', g.card_minor, 'qr', 0, 'nfc', 0),
       jsonb_build_object(
         'shift', jsonb_build_object(
           'id', g.shift_id, 'number', g.number, 'storeId', g.store_id, 'status', 'closed', 'openedAt', g.opened_at,
           'openedBy', g.cashier_id, 'closedAt', g.closed_at, 'receipts', g.receipts,
           'byMethod', jsonb_build_object(
             'cash', jsonb_build_object('count', g.cash_count, 'amountMinor', g.cash_minor),
             'card', jsonb_build_object('count', g.receipts - g.cash_count, 'amountMinor', g.card_minor),
             'qr', jsonb_build_object('count', 0, 'amountMinor', 0),
             'nfc', jsonb_build_object('count', 0, 'amountMinor', 0)),
           'revenueMinor', g.cash_minor + g.card_minor, 'discrepancyReceipts', 0,
           'cash', jsonb_build_object('openingMinor', 50000, 'salesMinor', g.cash_minor, 'inMinor', 0, 'outMinor', 0,
                                      'returnsMinor', 0, 'expectedMinor', 50000 + g.cash_minor),
           'events', '[]'::jsonb),
         'actualCashMinor', 50000 + g.cash_minor, 'discrepancyMinor', 0,
         'terminalDiff', jsonb_build_object('card', 0, 'qr', 0, 'nfc', 0), 'discrepancyReasonMissing', false),
       g.opened_at
from (
  select s.id as store_id, tm.id as terminal_id, c.id as cashier_id,
         load_gen.uuid7((d.day + time '07:50') at time zone 'Asia/Dushanbe',
                        'shift:' || s.no || ':' || tm.no || ':' || d.day) as shift_id,
         'СМ-' || s.code || '-' || extract(year from d.day) || '-'
           || lpad(((d.day - greatest(date_trunc('year', d.day)::date, :'history_from'::date)) * 3 + tm.no)::text, 6, '0')
           as number,
         (d.day + time '07:50') at time zone 'Asia/Dushanbe' as opened_at,
         (d.day + time '21:10') at time zone 'Asia/Dushanbe' as closed_at,
         coalesce(a.receipts, 0) as receipts, coalesce(a.cash_count, 0) as cash_count,
         coalesce(a.cash_minor, 0) as cash_minor, coalesce(a.card_minor, 0) as card_minor
  from load_gen.store s cross join d
  join load_gen.terminal tm on tm.store_no = s.no
  join load_gen.cashier c on c.store_no = s.no and c.idx = (tm.no - 1 + d.x) % s.cashiers
  left join (
    select store_no, terminal_no, day, count(*) as receipts, count(*) filter (where cash) as cash_count,
           coalesce(sum(subtotal) filter (where cash), 0) as cash_minor,
           coalesce(sum(subtotal) filter (where not cash), 0) as card_minor
    from t group by store_no, terminal_no, day
  ) a on a.store_no = s.no and a.terminal_no = tm.no and a.day = d.day
) g;

insert into load_gen.month (month_start, receipts, loaded_at) select :'month'::date, count(*), now() from t;
select format('month %s: %s receipts, %s lines', :'month', (select count(*) from t), (select count(*) from l)) as progress;
\endif

\if :is_finish
select value as tenant_id from load_gen.meta where key = 'tenant_id' \gset
select value as owner_id from load_gen.meta where key = 'owner_id' \gset

-- the stock a delivery brought: what its batch sold plus a reserve. The last batch of a product keeps 50–500 packs;
-- an older one is sold out or keeps a little. The most popular product of L01 keeps only its last batch, 10 000 packs:
-- the hot batch of the run (plan R12)
create temp table sold on commit drop as
select batch_id, -sum(qty_delta_pieces)::bigint as pieces
from pharmacy.stock_movements where tenant_id = :'tenant_id' and kind = 'sale'
group by batch_id;

create temp table g on commit drop as
select b.*, p.id as product_id, p.pieces, p.purchase_pack, p.cost_piece, p.price_pack, s.id as store_id, s.code,
       sup.id as supplier_id, coalesce(sold.pieces, 0) as sold_pieces,
       case when s.no = 1 and p.rank = 1 then case when b.period = b.k - 1 then 10000 else 0 end
            when b.period = b.k - 1 then 50 + floor(load_gen.u(b.store_no * 10000 + b.product_no, 50 + b.period) * 451)
            when load_gen.u(b.store_no * 10000 + b.product_no, 60 + b.period) < 0.7 then 0
            else 1 + floor(load_gen.u(b.store_no * 10000 + b.product_no, 70 + b.period) * 20) end::bigint as reserve_packs
from load_gen.batch b
join load_gen.product p on p.no = b.product_no
join load_gen.store s on s.no = b.store_no
join load_gen.supplier sup on sup.no = b.supplier_no
left join sold on sold.batch_id = b.batch_id;
alter table g add column qty bigint, add column line_id uuid, add column line_no int;
update g set qty = sold_pieces + greatest(reserve_packs, case when sold_pieces = 0 then 1 else 0 end) * pieces,
             line_id = load_gen.uuid7((delivered_on + time '10:00') at time zone 'Asia/Dushanbe',
                                      'grl:' || store_no || ':' || product_no || ':' || period);
with n as (select batch_id, row_number() over (partition by doc_id order by product_no) as n from g)
update g set line_no = n.n from n where n.batch_id = g.batch_id;

insert into pharmacy.documents
  (tenant_id, id, store_id, type, number, document_date, status, created_by, posted_by, posted_at, total_dirams,
   supplier_id, supplier_invoice_number, supplier_invoice_date, payment_due_date, created_at, updated_at)
select :'tenant_id', d.doc_id, d.store_id, 'goods_receipt',
       'ПР-' || d.code || '-' || extract(year from d.delivered_on) || '-'
         || lpad(row_number() over (partition by d.store_id, extract(year from d.delivered_on)
                                    order by d.delivered_on, d.supplier_no)::text, 6, '0'),
       d.delivered_on, 'posted', :'owner_id', :'owner_id', d.posted_at, d.total, d.supplier_id,
       'СФ-' || d.code || '-' || to_char(d.delivered_on, 'YYMMDD') || '-' || d.supplier_no, d.delivered_on,
       d.delivered_on + 14, d.posted_at, d.posted_at
from (
  select doc_id, store_id, code, delivered_on, supplier_no, supplier_id,
         (delivered_on + time '10:00') at time zone 'Asia/Dushanbe' as posted_at,
         sum(ceil(qty::numeric * purchase_pack / pieces))::bigint as total
  from g group by doc_id, store_id, code, delivered_on, supplier_no, supplier_id
) d;

insert into pharmacy.batches
  (tenant_id, id, store_id, product_id, expiry_date, lot_number, purchase_price_per_pack_dirams, cost_per_piece_dirams,
   supplier_id, origin, source_document_id, created_at)
select :'tenant_id', batch_id, store_id, product_id,
       delivered_on + 540 + floor(load_gen.u(store_no * 10000 + product_no, 80 + period) * 540)::int,
       'Л' || to_char(delivered_on, 'YYMM') || '-' || product_no, purchase_pack, cost_piece, supplier_id,
       'goods_receipt', doc_id, (delivered_on + time '10:00') at time zone 'Asia/Dushanbe'
from g;

insert into pharmacy.goods_receipt_lines
  (tenant_id, id, document_id, line_no, product_id, qty_pieces, expiry_date, lot_number, purchase_price_per_pack_dirams,
   retail_price_draft_dirams, batch_id, created_at)
select :'tenant_id', g.line_id, g.doc_id, g.line_no, g.product_id, g.qty, b.expiry_date, b.lot_number, g.purchase_pack,
       g.price_pack, g.batch_id, b.created_at
from g join pharmacy.batches b on b.tenant_id = :'tenant_id' and b.id = g.batch_id;

insert into pharmacy.stock_movements
  (tenant_id, id, recorded_at, store_id, batch_id, qty_delta_pieces, kind, source_type, source_id, source_line_id,
   business_date, origin)
select :'tenant_id', load_gen.uuid7((delivered_on + time '10:00') at time zone 'Asia/Dushanbe', 'in:' || batch_id),
       (delivered_on + time '10:00') at time zone 'Asia/Dushanbe', store_id, batch_id, qty, 'goods_receipt', 'document',
       doc_id, line_id, delivered_on, 'local'
from g;

-- the counters go on after the history: the run numbers its receipts and shifts after them
insert into pharmacy.document_counters (tenant_id, store_id, kind, year, last_number)
select :'tenant_id'::uuid, s.id, 'receipt', c.year, c.last
from load_gen.counter c join load_gen.store s on s.no = c.store_no
union all
select :'tenant_id'::uuid, store_id, 'z_report', extract(year from opened_at at time zone 'Asia/Dushanbe')::int,
       max(substring(number from '\d+$')::bigint)
from pharmacy.shifts where tenant_id = :'tenant_id' group by 1, 2, 3, 4
union all
select :'tenant_id'::uuid, store_id, 'goods_receipt', extract(year from document_date)::int,
       max(substring(number from '\d+$')::bigint)
from pharmacy.documents where tenant_id = :'tenant_id' and type = 'goods_receipt' group by 1, 2, 3, 4;

-- the keys of the receipts of the last two days, as the API keeps them (plan R5)
insert into pharmacy.idempotency_keys (tenant_id, scope, key, request_hash, status_code, response, created_at, expires_at)
select :'tenant_id', 'receipt', id, sha256(convert_to(id::text, 'UTF8')), 201,
       jsonb_build_object('id', id, 'number', number, 'fiscal', null, 'discrepancies', 0), received_at,
       received_at + interval '30 days'
from pharmacy.receipts
where tenant_id = :'tenant_id' and business_date >= :'today'::date - 2;

insert into pharmacy.store_sales_daily (tenant_id, store_id, business_date, receipts_count, sales_dirams, last_sold_at)
select :'tenant_id', store_id, business_date, count(*), sum(total_dirams), max(sold_at)
from pharmacy.receipts where tenant_id = :'tenant_id'
group by store_id, business_date;

insert into load_gen.meta
select 'hot_product_id', p.id::text from load_gen.product p where p.rank = 1
union all
select 'hot_batch_id', g.batch_id::text from g join load_gen.product p on p.no = g.product_no
where g.store_no = 1 and p.rank = 1 and g.period = g.k - 1
union all
select 'finished_at', now()::text;
\echo finish done
\endif
