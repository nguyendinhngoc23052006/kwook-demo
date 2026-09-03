-- Write down a source that only ever existed in the database.
--
-- `tiki` is live, active, sweeping, and has 69 observations against each of
-- its two listings — and appears in no migration. It was inserted by hand at
-- some point and never recorded, so the files and the database disagreed:
-- rebuilding this project from `supabase/migrations/` would have produced a
-- system missing a working source, two listings and their entire history,
-- with nothing anywhere to say what was lost.
--
-- That matters more than a missing row. This project's rule is that
-- migrations ARE the schema and merging IS applying; a database holding
-- anything the files do not is that rule quietly not being true. The other
-- hand-made changes were caught and written down properly — `lotte`,
-- `vietmart` and `newfresh` all left through migrations of their own. This
-- one was missed.
--
-- Deliberately additive and idempotent: on the live database every statement
-- is a no-op, because the rows are already there. Its whole purpose is to
-- make a from-scratch rebuild arrive at the same place.
--
-- Verified 2026-09-03 against the live database: sources.tiki and both URLs
-- below exist with exactly these values, and supabase_migrations records the
-- twelve migrations preceding this one and nothing else.

insert into sources (id, domain, display_name, type, fetch_strategy) values
  ('tiki', 'tiki.vn', 'Tiki', 'marketplace', 'single_page')
on conflict (id) do nothing;

-- Both are entry points: a single_page source has one product per URL, so
-- every row is something the sweep fetches rather than something it found.
--
-- The second URL is a ten-pack wholesale case, not a retail unit. Its
-- product_sku stays null on purpose — resolving a case of ten to the SKU for
-- one 400g bag would put a wholesale price into a retail comparison and
-- invent a dispersion finding out of a packaging difference. It sits in Chưa
-- khớp instead, which is where a listing nobody has decided about belongs.
insert into listing_urls (source_id, url, product_sku, resolved_by, is_entry_point) values
  ('tiki',
   'https://tiki.vn/400g-rong-bien-han-quoc-k-wook-date-4-2023-kim-vun-400g-p173727920.html',
   'KW-VUN-400', 'seed', true),
  ('tiki',
   'https://tiki.vn/si-mot-thung-10-goi-la-kim-rong-bien-vun-400gr-k-wook-han-quoc-p173727975.html',
   null, 'seed', true)
on conflict (url) do nothing;
