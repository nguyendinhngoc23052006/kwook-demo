-- Group the kitbuy listings that are the same product, and give the
-- single-page sources real URLs to fetch.
--
-- Aliases are matched by EXACT normalised title (see src/sweep/resolve.ts), so
-- every alias below is a title actually observed in a sweep. Nothing here is a
-- pattern or a guess at a title that might appear.
--
-- Re-runnable: every statement guards itself.

-- 1. The clusters -----------------------------------------------------------
--
-- Split by PACK SIZE, not by product family. 300g and 400g of the same
-- seaweed are different goods, and comparing their prices would manufacture a
-- spread that does not exist. Titles that name no size, or name two
-- ("300g, 400g"), are deliberately left unresolved rather than forced into
-- one of the two.

insert into products (sku, name_canonical, category, net_weight_g, pack_format, aliases) values
  ('KW-VUN-300', 'Rong biển vụn trộn cơm gói to 300g', 'vun', 300, 'goi', array[
    'Rong biển vụn trộn cơm, rắc cơm có vừng gói to 300g',
    'Rong biển vụn trộn cơm, rắc cơm có vừng gói to 300g -',
    'Rong biển vụn trộn cơm k-wook 300g'
  ]),
  ('KW-VUN-400', 'Rong biển vụn trộn cơm gói to 400g', 'vun', 400, 'goi', array[
    'Rong biển trộn cơm nhập khẩu Hàn Quốc 400g',
    'Rong biển vụn trộn cơm nhập khẩu Hàn Quốc 400g -'
  ]),
  ('KW-CUON-10LA', 'Rong biển cuộn cơm 10 lá 23-24g', 'cuon', 24, 'goi', array[
    'Rong biển cuộn cơm Gimbap, Sushi 10 Lá 23g,24g Hàn Quốc',
    'Rong Biển Cuộn Cơm Hàn Quốc K-WOOK 10 Lá 23g, 24g'
  ]),
  ('KW-YAKI-50', 'Rong biển cuộn cơm Yaki 50 lá', 'cuon', null, 'goi', array[
    'Rong biển cuộn cơm K-wook Yaki 50 Lá',
    'Rong biển cuộn cơm 50,100 lá Yaki - K-wook - Lá dày,Xanh'
  ]),
  -- LOWEST CONFIDENCE IN THIS FILE. The two titles are identical apart from
  -- the brand word, but neither states a pack size, so a 30.000 vs 185.000
  -- spread could be two different weights rather than a pricing problem.
  -- Grouped because the titles give a buyer no way to tell them apart either
  -- - which is itself the finding. Delete this row to drop it.
  ('KW-KHO-CANH', 'Rong biển khô nấu canh', 'kho', null, 'goi', array[
    'Rong biển khô nấu canh Hàn Quốc K-wook',
    'Rong biển khô nấu canh Hàn Quốc'
  ])
on conflict (sku) do update set
  aliases = excluded.aliases,
  name_canonical = excluded.name_canonical,
  net_weight_g = excluded.net_weight_g;

-- 2. Sources ----------------------------------------------------------------
--
-- The brand's OWN site is added as a source. It is the only place a
-- manufacturer's price appears, which is what floor_breach needs to mean
-- anything - until now reference_price_vnd had no origin.

insert into sources (id, domain, display_name, type, fetch_strategy) values
  ('kwookvn', 'kwookvietnam.com.vn', 'Kwook Việt Nam (chính hãng)', 'brand', 'single_page')
on conflict (id) do nothing;

-- Two seeded domains did not match the live sites.
update sources set domain = 'lottemart.com.vn' where id = 'lotte';
update sources set domain = 'vietmart.co'      where id = 'vietmart';

-- 3. Entry points -----------------------------------------------------------
--
-- product_sku is set here rather than resolved at sweep time: single-page
-- sources have one product per URL, so the mapping is known when the URL is
-- added. A URL whose product is not certain is left null and shows up in
-- Chưa khớp, same as any unmatched listing.

insert into listing_urls (source_id, url, product_sku, resolved_by) values
  ('kwookvn',  'https://kwookvietnam.com.vn/rong-bien-tron-com-vi-truyen-thong/',
               'KW-TRON-TT-50', 'seed'),
  ('abby',     'https://abby.vn/s/rong-bien-vun-truyen-thong-kwook-50g',
               'KW-TRON-TT-50', 'seed'),
  ('abby',     'https://abby.vn/s/la-rong-bien-kwook-10-la/',
               'KW-CUON-10LA', 'seed'),
  ('abby',     'https://abby.vn/s/la-rong-bien-an-lien-kwook-4-5g',
               null, 'seed'),
  ('tripmap',  'https://marketplace.tripmap.vn/product/rong-bien-cuon-com-kimbap-100-la-250g-giam-gia-cuc-soc-chi-289-999d',
               'KW-CUON-100LA-250', 'seed'),
  ('vietmart', 'https://vietmart.co/rong-bien-han-quoc-k-wook-s-cuon-kimbap-24g-10-la-s11990057393.html',
               'KW-CUON-10LA', 'seed')
on conflict (url) do update set product_sku = excluded.product_sku;
