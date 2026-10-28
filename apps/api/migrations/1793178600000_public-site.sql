-- Up Migration
-- The public site (ADR-0023, spec 2026-10-28-public-site-design, 7.1 and 7.4): the settings of the site, the
-- pictures, the articles with translations, the revisions of the offer and of the privacy policy, and the
-- connection requests of the visitors. All tables are class `platform` (no tenant data): RLS enabled and forced,
-- the platform path only, select/insert/update and never DELETE (rows are archived or anonymized instead).
-- The revisions of the documents are append-only: a connection request refers to the revision it consented to.
-- The notification kind `connection_requested` and the mute topic `leads` are added to their CHECKs.

set local lock_timeout = '5s';

-- The pictures of the site live in the database (P3): they get into the backups (ADR-0019).
create table pharmacy.site_media (
  id uuid primary key,
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  bytes bytea not null check (octet_length(bytes) between 1 and 2097152),
  sha256 bytea not null unique check (octet_length(sha256) = 32),
  width integer not null check (width between 1 and 20000),
  height integer not null check (height between 1 and 20000),
  alt text not null default '' check (char_length(alt) <= 200),
  created_by uuid not null references pharmacy.operators (id),
  created_at timestamptz not null default now()
);

-- One row (id = 1), like platform_settings; the texts are {"ru": "...", "tg": "..."}.
create table pharmacy.site_settings (
  id smallint primary key check (id = 1),
  name jsonb not null default '{"ru":"","tg":""}' check (jsonb_typeof(name) = 'object'),
  tagline jsonb not null default '{"ru":"","tg":""}' check (jsonb_typeof(tagline) = 'object'),
  seo_description jsonb not null default '{"ru":"","tg":""}' check (jsonb_typeof(seo_description) = 'object'),
  address jsonb not null default '{"ru":"","tg":""}' check (jsonb_typeof(address) = 'object'),
  working_hours jsonb not null default '{"ru":"","tg":""}' check (jsonb_typeof(working_hours) = 'object'),
  logo_media_id uuid references pharmacy.site_media (id),
  favicon_media_id uuid references pharmacy.site_media (id),
  og_image_media_id uuid references pharmacy.site_media (id),
  phone text not null default '' check (char_length(phone) <= 50),
  email text not null default '' check (char_length(email) <= 254),
  telegram_url text not null default '' check (char_length(telegram_url) <= 300),
  whatsapp_url text not null default '' check (char_length(whatsapp_url) <= 300),
  updated_at timestamptz not null default now(),
  updated_by uuid references pharmacy.operators (id)
);
insert into pharmacy.site_settings (id) values (1);

create table pharmacy.articles (
  id uuid primary key,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 120),
  status text not null default 'draft' check (status in ('draft', 'published', 'unpublished', 'archived')),
  cover_media_id uuid references pharmacy.site_media (id),
  published_at timestamptz,
  version integer not null default 1 check (version >= 1),
  created_by uuid not null references pharmacy.operators (id),
  created_at timestamptz not null default now(),
  updated_by uuid not null references pharmacy.operators (id),
  updated_at timestamptz not null default now(),
  check (status not in ('published', 'unpublished') or published_at is not null)
);
create index articles_status_published_idx on pharmacy.articles (status, published_at desc);
create index articles_cover_media_idx on pharmacy.articles (cover_media_id) where cover_media_id is not null;

create table pharmacy.article_translations (
  article_id uuid not null references pharmacy.articles (id),
  locale text not null check (locale in ('ru', 'tg')),
  title text not null check (char_length(title) between 3 and 150),
  excerpt text not null default '' check (char_length(excerpt) <= 300),
  body text not null default '' check (char_length(body) <= 100000),
  seo_title text not null default '' check (char_length(seo_title) <= 70),
  seo_description text not null default '' check (char_length(seo_description) <= 160),
  primary key (article_id, locale)
);

-- Append-only: a new edition is a new row; nothing is changed or deleted (the consents refer to them).
create table pharmacy.legal_document_revisions (
  id uuid primary key,
  kind text not null check (kind in ('offer', 'privacy')),
  locale text not null check (locale in ('ru', 'tg')),
  title text not null check (char_length(title) between 3 and 200),
  body text not null check (char_length(body) between 1 and 200000),
  effective_from date not null,
  published_at timestamptz not null default now(),
  published_by uuid not null references pharmacy.operators (id)
);
create index legal_document_revisions_current_idx
  on pharmacy.legal_document_revisions (kind, locale, effective_from desc, published_at desc);
create index legal_document_revisions_published_by_idx
  on pharmacy.legal_document_revisions (published_by);

create trigger legal_document_revisions_no_update_delete
  before update or delete on pharmacy.legal_document_revisions
  for each row execute function pharmacy.forbid_mutation();
create trigger legal_document_revisions_no_truncate
  before truncate on pharmacy.legal_document_revisions
  for each statement execute function pharmacy.forbid_mutation();

-- The draft of the next edition: one per kind and locale.
create table pharmacy.legal_document_drafts (
  kind text not null check (kind in ('offer', 'privacy')),
  locale text not null check (locale in ('ru', 'tg')),
  title text not null check (char_length(title) between 3 and 200),
  body text not null check (char_length(body) between 1 and 200000),
  effective_from date not null,
  updated_at timestamptz not null default now(),
  updated_by uuid not null references pharmacy.operators (id),
  primary key (kind, locale)
);

-- The personal data (contact_name, phone, email, comment, call_time, client_ip, operator_note) is set to null
-- by the anonymization of the retention pass (7.4); the row itself stays.
create table pharmacy.connection_requests (
  id uuid primary key,
  status text not null default 'new' check (status in ('new', 'in_progress', 'connected', 'rejected', 'spam')),
  network_name text not null check (char_length(network_name) between 1 and 120),
  city text not null check (char_length(city) between 1 and 120),
  store_count integer not null check (store_count between 1 and 500),
  contact_name text check (char_length(contact_name) between 2 and 120),
  phone text check (phone ~ '^\+[0-9]{8,15}$'),
  email text check (char_length(email) <= 254),
  inn text check (inn ~ '^[0-9]{9}$'),
  call_time text check (char_length(call_time) <= 100),
  comment text check (char_length(comment) <= 500),
  locale text not null check (locale in ('ru', 'tg')),
  privacy_document_id uuid not null references pharmacy.legal_document_revisions (id),
  client_ip inet,
  created_at timestamptz not null default now(),
  assigned_to uuid references pharmacy.operators (id),
  operator_note text check (char_length(operator_note) <= 1000),
  reject_reason text check (char_length(reject_reason) between 5 and 500),
  tenant_id uuid references pharmacy.tenants (id),
  decided_at timestamptz,
  decided_by uuid references pharmacy.operators (id),
  anonymized_at timestamptz,
  check (status <> 'connected' or tenant_id is not null),
  check (anonymized_at is not null or (contact_name is not null and phone is not null))
);
create index connection_requests_status_idx on pharmacy.connection_requests (status, created_at);
create index connection_requests_phone_idx on pharmacy.connection_requests (phone, created_at);
create index connection_requests_created_idx on pharmacy.connection_requests (created_at);
create index connection_requests_privacy_idx on pharmacy.connection_requests (privacy_document_id);
create index connection_requests_tenant_idx on pharmacy.connection_requests (tenant_id) where tenant_id is not null;

-- Notifications of the operators: a new request; the mute topic of the leads.
alter table pharmacy.platform_notifications
  drop constraint platform_notifications_kind_check,
  add constraint platform_notifications_kind_check check (kind in ('invoice_overdue', 'key_expiring',
    'key_revoked', 'service_requested', 'sync_stale', 'payment_recorded', 'update_available',
    'connection_requested'));
alter table pharmacy.operators
  drop constraint operators_muted_notification_topics_check,
  add constraint operators_muted_notification_topics_check
    check (muted_notification_topics <@ array['billing', 'keys', 'services', 'sync', 'leads']::text[]);

-- Row level security: enabled and forced; only the platform path (pharmacy_app has no access).
alter table pharmacy.site_media enable row level security;
alter table pharmacy.site_media force row level security;
alter table pharmacy.site_settings enable row level security;
alter table pharmacy.site_settings force row level security;
alter table pharmacy.articles enable row level security;
alter table pharmacy.articles force row level security;
alter table pharmacy.article_translations enable row level security;
alter table pharmacy.article_translations force row level security;
alter table pharmacy.legal_document_revisions enable row level security;
alter table pharmacy.legal_document_revisions force row level security;
alter table pharmacy.legal_document_drafts enable row level security;
alter table pharmacy.legal_document_drafts force row level security;
alter table pharmacy.connection_requests enable row level security;
alter table pharmacy.connection_requests force row level security;

create policy platform_all on pharmacy.site_media for all to pharmacy_platform
  using (true) with check (true);
create policy platform_all on pharmacy.site_settings for all to pharmacy_platform
  using (true) with check (true);
create policy platform_all on pharmacy.articles for all to pharmacy_platform
  using (true) with check (true);
create policy platform_all on pharmacy.article_translations for all to pharmacy_platform
  using (true) with check (true);
create policy platform_all on pharmacy.legal_document_revisions for all to pharmacy_platform
  using (true) with check (true);
create policy platform_all on pharmacy.legal_document_drafts for all to pharmacy_platform
  using (true) with check (true);
create policy platform_all on pharmacy.connection_requests for all to pharmacy_platform
  using (true) with check (true);

grant select, insert, update on pharmacy.site_media to pharmacy_platform;
grant select, insert, update on pharmacy.site_settings to pharmacy_platform;
grant select, insert, update on pharmacy.articles to pharmacy_platform;
grant select, insert, update on pharmacy.article_translations to pharmacy_platform;
grant select, insert on pharmacy.legal_document_revisions to pharmacy_platform;
grant select, insert, update on pharmacy.legal_document_drafts to pharmacy_platform;
grant select, insert, update on pharmacy.connection_requests to pharmacy_platform;
