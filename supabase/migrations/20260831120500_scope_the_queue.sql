-- Make "Chưa khớp" mean "someone still has to decide this".
--
-- The queue held 14 listings and never moved, because it mixed three
-- unrelated things: products we had not catalogued yet, listings that are not
-- Kwook's at all, and listings we deliberately refuse to resolve. Only the
-- first is work.

-- 1. Out of scope is a state a listing can be in --------------------------
alter table listing_urls add column if not exists out_of_scope boolean not null default false;
alter table listing_urls add column if not exists out_of_scope_brand text;

comment on column listing_urls.out_of_scope is
  'The listing names a brand that is not Kwook, so it can never match a SKU. Set by the sweep, not by hand.';

-- 2. Catalogue the Kwook products that were simply missing ----------------
--
-- Every alias is a title observed in a sweep; resolution is exact-match.
-- The lá kim family is THREE SKUs, not one: 1 gói, lốc 3 and lốc 15 are
-- different goods, and comparing 85.000 against 10.800 would report volume
-- pricing as a pricing violation.
insert into products (sku, name_canonical, category, net_weight_g, pack_format, aliases) values
  ('KW-KHAN-80', 'Khăn giấy ướt Hanarin 80 tờ', 'phi-thuc-pham', null, 'thung', array[
    '- Thùng khăn giấy ướt K-wook Hanarin 80 tờ cao cấp nhập khẩu Hàn Quốc - an toàn cho bé'
  ]),
  ('KW-KHAN-100', 'Khăn giấy ướt 100 tờ', 'phi-thuc-pham', null, 'thung', array[
    'Thùng - Khăn giấy ướt 100 Tờ nhập khẩu Hàn Quốc - An toàn cho bé'
  ]),
  ('KW-CUCAI', 'Củ cải vàng', 'rau-cu', null, 'goi', array[
    'Củ cải vàng K-wook 1.4Kg - 2.8Kg'
  ]),
  ('KW-LAKIM-1', 'Lá kim ăn liền 4,5g - gói lẻ', 'an-lien', 5, 'goi', array[
    'Lá rong biển ăn liền Kwook 4.5g'
  ]),
  ('KW-LAKIM-3', 'Lá kim ăn liền trẻ em - lốc 3 gói', 'an-lien', 14, 'loc', array[
    'Lá kim ăn liền K-WOOK dành riêng cho trẻ em lốc 3 gói*4,5G'
  ]),
  ('KW-LAKIM-15', 'Lá kim ăn liền trẻ em - lốc 15 gói', 'an-lien', 68, 'loc', array[
    'Lốc 15 gói lá Kim ăn liền K-WOOK - Cao Cấp - dành riêng cho trẻ em'
  ]),
  ('KW-ANLIEN-16', 'Rong biển ăn liền 5g - lốc 16 gói', 'an-lien', 80, 'loc', array[
    'Lốc 16 gói rong biển ăn liền Hàn Quốc 5g*16 Gói'
  ])
on conflict (sku) do update set
  aliases = excluded.aliases,
  name_canonical = excluded.name_canonical;

-- abby is a single-page source: its listing carries its SKU on the row
-- itself rather than being resolved from the title at sweep time.
update listing_urls
   set product_sku = 'KW-LAKIM-1', resolved_by = 'seed'
 where url = 'https://abby.vn/s/la-rong-bien-an-lien-kwook-4-5g';
