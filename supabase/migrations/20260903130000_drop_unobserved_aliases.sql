-- Drop the four aliases that were guesses, so the catalogue's own claim is true.
--
-- 20260831071500 says of its rows: "every alias below is a title actually
-- observed in a sweep. Nothing here is a pattern or a guess at a title that
-- might appear." That was true of that file. It was not true of the FIRST
-- seed, 20260830230000, which was written before any sweep had run - its
-- aliases came from reading seller pages by hand, and four of them have never
-- matched a title in any sweep since.
--
-- Checked 2026-09-03 by normalising all 29 aliases with the same fold
-- src/sweep/resolve.ts applies (via normalizeTitle in src/lib/vnd.ts) and comparing
-- against every title_seen ever recorded: 25 matched, these 4 did not.
--
-- They were harmless - an alias that matches nothing simply never resolves
-- anything, and all 14 SKUs still resolve through their surviving aliases.
-- They were also the only guesses in a system whose entire argument is that
-- it does not guess, which is worth more than four dead strings. Removing
-- them makes the invariant hold catalogue-wide rather than per-file.
--
-- The seed itself is left alone. 20260830230000 still inserts all four, and
-- its `on conflict do update set aliases = excluded.aliases` means a rebuild
-- from scratch puts them back - then this migration, which sorts after it,
-- takes them out again. Editing applied DML would make a fresh database
-- disagree with the history that produced the live one, which is a worse
-- trade than one redundant write during a rebuild.
--
-- Re-runnable: array_remove on an absent element is a no-op.

update products
   set aliases = array_remove(aliases, 'Rong biển cuộn cơm 100 lá Kwook Cao cấp – 250G (Premium Gold)')
 where sku = 'KW-CUON-100LA-250';

update products
   set aliases = array_remove(
                   array_remove(
                     array_remove(aliases, 'Rong biển trộn cơm vị truyền thống Kwook'),
                     'Rong Biển Trộn Cơm Ăn Liền Kwook Vị Truyền Thống 50G'),
                   'Rong biển trộn cơm vị truyền thống vụn Kids 50g')
 where sku = 'KW-TRON-TT-50';
