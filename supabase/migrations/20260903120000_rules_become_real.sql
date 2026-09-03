-- The rules table starts controlling the detectors it describes.
--
-- Until now nothing read it. The thresholds in detect.ts were hardcoded
-- defaults that happened to equal these seeded values, so the table looked
-- authoritative and was inert: setting gap_pct to 40 here changed nothing.
-- src/sweep/events.ts now reads type, threshold, severity and active on every
-- sweep, which makes the rows below the actual control surface.
--
-- Re-runnable: every statement is an idempotent update of an existing row.

-- attribution_loss comes back on, with the spellings that count as correct.
--
-- It was switched off in code because feeding it kitbuy's 29 brand-less cards
-- flagged every one of them hourly. That was the wrong lever: absence of a
-- brand field is not a lost attribution, so the detector is now scoped to the
-- observations that actually carry one. Measured 2026-09-03 over 3081
-- observations: tiki publishes a brand on all 150 of its own and spells it
-- "K-Wook"; tteokbokki publishes on 10 and spells it "Kwook". Both spellings
-- are the brand, so both are accepted and the check passes - which is the
-- point. An unrecognised spelling appearing later is the finding.
update rules
   set threshold = '{"accepted":["Kwook","K-WOOK","K-Wook","KWOOK"]}'::jsonb,
       active    = true
 where id = 'attribution_loss';

-- floor_breach stays defined and stays off, because it cannot answer.
--
-- It compares a selling price against products.reference_price_vnd, and that
-- column is null for all 14 products: no official Kwook RRP is published
-- anywhere reachable, and the wholesale prices found instead (195.000 /
-- 295.000 / 300.000 for the same pack) disagree with each other too much to
-- stand in for one. Leaving it active would have the dashboard report "no
-- floor breaches" every hour, which is a claim the data cannot support. Off
-- says the honest thing: this check is not running.
update rules
   set active = false
 where id = 'floor_breach';
