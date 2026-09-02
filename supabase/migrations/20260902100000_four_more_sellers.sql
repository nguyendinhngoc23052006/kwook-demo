-- Four more sellers, every one of them proven before it was written here.
--
-- Sixteen candidates were researched; four fetch and parse. Each URL below was
-- run through `npm run probe` on a GitHub runner (workflow: probe) and printed
-- USABLE with the price and extraction method recorded in its comment. The
-- twelve that failed are listed at the bottom so nobody researches them twice.
--
-- Why this matters more than the listing count suggests: it takes TWO sellers
-- of the same SKU before `dispersion` can say anything at all. KW-LAKIM-3 had
-- exactly one listing and was therefore invisible to every cross-seller
-- detector. Now it has two.
--
-- Re-runnable: every statement guards itself.

-- 1. The sellers -------------------------------------------------------------
--
-- All single_page: each is one product page, unlike kitbuy's store index which
-- yields thirty listings from one fetch. type is descriptive only - no code
-- reads sources.type; the detectors compare listings, never labels.

insert into sources (id, domain, display_name, type, fetch_strategy) values
  ('tteokbokki',  'tteokbokki.vn',  'Tèobokki (đồ Hàn)',        'reseller',   'single_page'),
  ('thitruongsi', 'thitruongsi.com', 'Thị Trường Sỉ (bán buôn)', 'wholesale',  'single_page'),
  ('cphfood',     'cphfood.vn',      'CPH Food',                 'reseller',   'single_page'),
  ('hunglongmart', 'hunglongmart.vn', 'Hùng Long Mart',          'reseller',   'single_page')
on conflict (id) do nothing;

-- 2. Entry points ------------------------------------------------------------
--
-- product_sku is seeded rather than resolved at sweep time: a single-page
-- source has one product per URL, so the mapping is known when the URL is
-- added, and the probe printed the title that confirms it.

insert into listing_urls (source_id, url, product_sku, resolved_by) values
  -- probe: USABLE 190.000 đ | json-ld | "Rong biển vụn Kwook 400g"
  ('tteokbokki',   'https://tteokbokki.vn/products/rong-bien-vun-kwook-400g',
                   'KW-VUN-400', 'seed'),

  -- probe: USABLE 195.000 đ | json-ld | "RONG BIỂN CUỘN CƠM HÀN QUỐC K'WOOK 100 LÁ"
  ('thitruongsi',  'https://thitruongsi.com/rong-bien-cuon-com-han-quoc-k-wook-100-la-2159998.html',
                   'KW-CUON-100LA-250', 'seed'),

  -- probe: USABLE 280.000 đ | meta | "Lá Rong Biển K'WOOK 240G 100 Lá"
  -- The catalogue calls this pack 250g and this shop calls it 240g; existing
  -- listings already disagree the same way, and "100 lá" is unambiguous.
  ('cphfood',      'https://cphfood.vn/la-rong-bien-k-wook',
                   'KW-CUON-100LA-250', 'seed'),

  -- probe: USABLE 25.000 đ | meta | "Rong Biển Ăn Liền K-Wook'S Kid'S 4.5G*3 Gói"
  -- The one that changes what the dashboard can say: KW-LAKIM-3 had a single
  -- listing, so no cross-seller comparison existed for it.
  ('hunglongmart', 'https://hunglongmart.vn/rong-bien-an-lien-k-wook-s-kid-s-4-5g-3-goi',
                   'KW-LAKIM-3', 'seed')
on conflict (url) do nothing;

-- 3. What was tried and did not work -----------------------------------------
--
-- Recorded so the next person does not spend a research cycle rediscovering
-- it. Probed 2026-09-02 on a GitHub runner; all fetched over the same network
-- the hourly sweep uses.
--
--   shopee.vn (store page and 2 product pages)
--       196.860 chars every time - the same SPA shell, no server-rendered
--       price. This is precisely why the demo reads kitbuy.vn, a mirror,
--       instead of Shopee directly.
--   lazada.vn (6 product pages)
--       ~2.000 chars: a bot wall, not a page.
--   tteokbokki.vn/collections/cac-loai-rong-bien-han-quoc
--       FETCHED FINE - 697.127 chars, correct title. It failed only because
--       parseProductPage reads one product and this is a grid of many. A
--       store-index parser like parse.ts would turn this single URL into
--       several listings; that is the highest-value work left here.
--   bachhoa.extra.vn - HTTP 522, the origin is down.
--   nhatminhbaby.vn - 11.597 chars, price rendered client-side.
--   kwookvietnam.com.vn - already a deactivated source; still bot-walled.
--   vietmart.co - proposed again by research; the domain does not resolve and
--       was deleted by an earlier migration. Do not re-add it.
