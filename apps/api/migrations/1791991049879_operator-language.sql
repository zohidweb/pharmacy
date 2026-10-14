-- Up Migration
-- operators.language - the interface language of a platform operator (profile, data model 01),
-- applied by the admin at sign-in. Stored as employees.language is: `tg` of the UI is `tj` here.
-- A constant default adds the column without a table rewrite; the table-level grants of
-- pharmacy_platform (select, insert, update) already cover it.
alter table pharmacy.operators
  add column language text not null default 'ru' check (language in ('ru', 'tj'));
