-- Stop calling a two-pack-size listing one product.
--
-- 20260831071500 set the rule and this row broke it: "Titles that name no
-- size, or name two ('300g, 400g'), are deliberately left unresolved rather
-- than forced into one of the two." KW-CUCAI's only alias is
-- "Củ cải vàng K-wook 1.4Kg - 2.8Kg" - one seller page covering both pack
-- sizes - and it was resolved anyway, with net_weight_g left null because no
-- single weight is true of it.
--
-- Harmless so far only because that SKU has one listing, so no spread is ever
-- computed for it. A second listing at the other pack size would have the
-- system compare a 1.4kg price against a 2.8kg one and report a ~100% spread
-- that does not exist - the exact false alert the pack-size split exists to
-- prevent.
--
-- BOTH halves are required. Clearing the listing alone reverts on the next
-- sweep: resolveByAlias matches the observed title against this alias and
-- re-resolves it within the hour. The alias has to go first.
--
-- The product row STAYS. Kwook does sell pickled radish; what is unknown is
-- which pack this listing is selling. Deleting the product would claim the
-- product is not real, which is a different and wrong statement. It keeps no
-- alias, so it resolves nothing until someone adds a pack-specific one.
--
-- Re-runnable: array_remove and the guarded update are both no-ops second time.

update products
   set aliases = array_remove(aliases, 'Củ cải vàng K-wook 1.4Kg - 2.8Kg')
 where sku = 'KW-CUCAI';

update listing_urls
   set product_sku        = null,
       resolve_confidence = null,
       resolved_by        = null
 where product_sku = 'KW-CUCAI';
