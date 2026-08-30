-- Seed the SKUs and detector thresholds. Re-runnable.

insert into products (sku, name_canonical, category, net_weight_g, pack_format, aliases) values
  ('KW-CUON-100LA-250', 'Rong biển cuộn cơm 100 lá', 'cuon_com', 250, '100 lá / 250g', array[
    'Rong biển cuộn cơm 100 lá K-WOOK cao cấp',
    'Rong biển cuộn cơm 100 lá - -',
    'Rong biển Cuộn cơm Hàn Quốc 100 lá 250g - CÓ ZIP -',
    'Rong biển cuộn cơm 100 lá K-wook nhập khẩu Hàn Quốc',
    'Rong biển cuộn cơm 100 Lá Hàn Quốc',
    'Rong biển cuộn cơm 100 lá Kwook Cao cấp – 250G (Premium Gold)'
  ]),
  ('KW-TRON-TT-50', 'Rong biển trộn cơm vị truyền thống', 'tron_com', 50, '50g', array[
    'Rong biển trộn cơm vị truyền thống Kwook',
    'Rong Biển Trộn Cơm Ăn Liền Kwook Vị Truyền Thống 50G',
    'Rong biển vụn truyền thống Kwook 50g',
    'Rong biển trộn cơm vị truyền thống vụn Kids 50g'
  ])
on conflict (sku) do update set aliases = excluded.aliases;

insert into rules (id, type, threshold, severity) values
  ('self_cannibalization', 'self_cannibalization', '{"gap_pct":25}',      'high'),
  ('dead_listing',         'dead_listing',         '{"window_hours":24}', 'medium'),
  ('dispersion',           'dispersion',           '{"pct":30}',          'medium'),
  ('floor_breach',         'floor_breach',         '{"tolerance":0.1}',   'high'),
  ('fake_anchor',          'fake_anchor',          '{"multiple":3}',      'medium'),
  ('attribution_loss',     'attribution_loss',     '{}',                  'high'),
  ('new_seller',           'new_seller',           '{}',                  'info')
on conflict (id) do nothing;
