-- Two changes that only make sense together: say which URLs are entry points,
-- and switch tteokbokki to its shop's JSON catalogue.

-- 1. Which URLs does a sweep actually FETCH? ---------------------------------
--
-- Until now: all of them. `listing_urls` held two different kinds of row and
-- nothing told them apart - the URL a sweep starts from, and the product URLs
-- a store-index parse discovered. Both were fetched every hour.
--
-- For kitbuy that is 30 fetches to do the work of 1. The store index yields
-- all 29 products in its first response; the other 29 rows are then fetched
-- and handed to a store-index parser that finds no product grid in a product
-- page, returning nothing. With the three-second politeness delay between
-- fetches, most of a sweep's runtime was spent re-fetching pages whose
-- contents had already been read.
--
-- It also blocks catalog_json outright. A catalogue source's discovered rows
-- would each be fetched and handed to the JSON parser, which would find no
-- JSON in an HTML product page and correctly report a broken endpoint - an
-- error per product per hour, on a source that is working perfectly.
alter table listing_urls
  add column if not exists is_entry_point boolean not null default false;

comment on column listing_urls.is_entry_point is
  'True for a URL the sweep starts from. False for a product discovered by '
  'parsing one. Only entry points are fetched.';

-- 2. Backfill, stated explicitly rather than inferred ------------------------
--
-- A single_page source has one product per URL, so every row is an entry
-- point. A store_index source has exactly one: the index itself. Naming
-- kitbuy's index literally beats a clever rule - the discovered rows carry no
-- field that reliably distinguishes them, and guessing wrong here silently
-- stops a source being swept.
update listing_urls set is_entry_point = true
where source_id in (select id from sources where fetch_strategy = 'single_page');

update listing_urls set is_entry_point = true
where url = 'https://kitbuy.vn/kwookvietnamco.ltd';

-- 3. tteokbokki reads its catalogue now --------------------------------------
--
-- Probed on a GitHub runner 2026-09-02: the collection endpoint returns 159
-- products, 5 of them Kwook, against the 1 its single product URL was giving.
-- Two of those five are products no other seller carries, and the 400g pack
-- came back at 190.000 đ - the same figure the product page has been
-- reporting, which is what proves the Shopify major-unit string is being read
-- correctly.
--
--   300.000 đ  Rong biển cuộn cơm 100 lá Kwook 230g
--   320.000 đ  Rong biển cuộn cơm 100 lá Premium Gold Kwook 250g
--   285.000 đ  Rong biển cuộn cơm tam giác 100 lá Kwook 125g
--   190.000 đ  Rong biển vụn Kwook 400g
--   100.000 đ  Rong biển nấu canh Kwook 200g
update sources set fetch_strategy = 'catalog_json' where id = 'tteokbokki';

-- The product URL stops being what we fetch and becomes what we find. Its
-- history is kept: the catalogue builds this exact URL from the product
-- handle, so the hourly upsert lands on this same row rather than a new one.
update listing_urls set is_entry_point = false
where url = 'https://tteokbokki.vn/products/rong-bien-vun-kwook-400g';

insert into listing_urls (source_id, url, is_entry_point) values
  ('tteokbokki',
   'https://tteokbokki.vn/collections/cac-loai-rong-bien-han-quoc/products.json?limit=250',
   true)
on conflict (url) do nothing;

-- 4. What was probed and rejected --------------------------------------------
--
-- Recorded so nobody spends another research cycle on it. Nineteen domains
-- and seven product pages were probed on the runner 2026-09-02; none yielded
-- a single Kwook listing.
--
--   Not Shopify/Sapo at all (404 on the catalogue endpoint): minhcaumart.vn,
--       phatthinhphatfoods.com, thucphamhq.vn, nguyenhyfood.com, tienkhang.com,
--       hfoods.vn, farmersmarket.vn
--   Catalogue works, stocks no Kwook: thucphamhanquoc.com.vn (50),
--       organicfood.vn (50), dovumart.vn (150 across 3 endpoints, including a
--       collection named rong-bien)
--   Refused or broken: mintymart.com.vn (403), xinchaokoreamart.com (500),
--       marketsaigon.vn, cuahangkorea.com, dolambanh.com (unreachable),
--       haluong.com, nafarm.vn, k-market.vn (no catalogue endpoint)
--   Sells Kwook but renders price client-side, like Shopee: minhcaumart.vn,
--       phatthinhphatfoods.com
--
-- abby.vn is deliberately NOT a catalogue source. Its WooCommerce Store API
-- reports prices EXCLUDING tax - 10.000 where its own product page shows
-- 10.800, exactly 1,08x - and the response carries no tax-inclusive field.
-- Mixing those with page-scraped prices would invent an 8% dispersion finding
-- out of nothing, which is the exact failure this tool exists to detect.
-- Hardcoding the multiplier was rejected too: Vietnam's 8% reduced VAT is
-- temporary legislation, so it is a number that would rot silently. Its three
-- single-page URLs already cover the three Kwook products it stocks.
