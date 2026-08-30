-- GIÁ SÀN — initial schema + source seed.
-- Re-runnable: every statement guards itself, so a replay is a no-op.

create extension if not exists pgcrypto;

create table if not exists products (
  sku                  text primary key,
  name_canonical       text not null,
  category             text,
  net_weight_g         int,
  pack_format          text,
  reference_price_vnd  int,
  reference_source     text,
  aliases              text[] not null default '{}',
  cong_bo              text
);

create table if not exists sources (
  id                   text primary key,
  domain               text not null,
  display_name         text not null,
  type                 text,
  fetch_strategy       text not null default 'single_page',
  robots_allowed       boolean not null default true,
  active               boolean not null default true,
  consecutive_failures int not null default 0,
  last_success_at      timestamptz
);

create table if not exists listing_urls (
  id                 uuid primary key default gen_random_uuid(),
  source_id          text not null references sources(id),
  url                text not null unique,
  product_sku        text references products(sku),
  resolve_confidence numeric,
  resolved_by        text,
  first_seen_at      timestamptz not null default now(),
  last_seen_at       timestamptz not null default now()
);

create table if not exists sweeps (
  id                uuid primary key default gen_random_uuid(),
  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  sources_attempted int not null default 0,
  sources_ok        int not null default 0,
  listings_observed int not null default 0,
  model_calls       int not null default 0,
  errors            jsonb not null default '[]'
);

create table if not exists observations (
  id                 uuid primary key default gen_random_uuid(),
  listing_url_id     uuid not null references listing_urls(id),
  sweep_id           uuid not null references sweeps(id),
  price_vnd          int,
  original_price_vnd int,
  discount_pct       numeric,
  units_sold         int,
  review_count       int,
  in_stock           boolean,
  brand_string       text,
  title_seen         text,
  raw_excerpt        text,
  extract_confidence jsonb,
  observed_at        timestamptz not null default now(),
  unique (listing_url_id, sweep_id)
);

create table if not exists rules (
  id        text primary key,
  type      text not null,
  threshold jsonb not null default '{}',
  severity  text not null default 'medium',
  active    boolean not null default true
);

create table if not exists events (
  id             uuid primary key default gen_random_uuid(),
  sweep_id       uuid not null references sweeps(id),
  type           text not null,
  product_sku    text references products(sku),
  listing_url_id uuid references listing_urls(id),
  old_value      text,
  new_value      text,
  severity       text not null default 'medium',
  rule_id        text references rules(id),
  created_at     timestamptz not null default now()
);

create index if not exists observations_listing_observed_idx on observations (listing_url_id, observed_at desc);
create index if not exists events_sweep_severity_idx          on events (sweep_id, severity);
create index if not exists listing_urls_source_idx            on listing_urls (source_id);

-- RLS: the browser reads, only the service key writes.
alter table products     enable row level security;
alter table sources      enable row level security;
alter table listing_urls enable row level security;
alter table sweeps       enable row level security;
alter table observations enable row level security;
alter table rules        enable row level security;
alter table events       enable row level security;

do $$
declare t text;
begin
  foreach t in array array['products','sources','listing_urls','sweeps','observations','rules','events']
  loop
    if not exists (select 1 from pg_policies where tablename = t and policyname = 'anon_read') then
      execute format('create policy anon_read on %I for select to anon using (true)', t);
    end if;
  end loop;
end $$;

-- The five sources. Idempotent.
insert into sources (id, domain, display_name, type, fetch_strategy) values
  ('kitbuy',   'kitbuy.vn',              'Kitbuy (Shopee mirror)', 'primary',    'store_index'),
  ('lotte',    'lottemart.vn',           'Lotte Mart',             'reference',  'single_page'),
  ('abby',     'abby.vn',                'Abby',                   'reseller',   'single_page'),
  ('tripmap',  'marketplace.tripmap.vn', 'Tripmap Marketplace',    'aggregator', 'single_page'),
  ('vietmart', 'xn--vitmart-fya.vn',     'Vietmart (Lazada)',      'aggregator', 'single_page')
on conflict (id) do nothing;

insert into listing_urls (source_id, url) values
  ('kitbuy', 'https://kitbuy.vn/kwookvietnamco.ltd')
on conflict (url) do nothing;
