-- Remove the two sources that have no reachable URL and no prospect of one.
--
-- Lotte Mart:  no Kwook product page was ever located on lottemart.com.vn.
-- Vietmart:    both spellings of the host fail DNS outright - vietmart.co and
--              the originally seeded xn--vitmart-fya.vn. The site is gone.
--
-- Neither has ever been swept and neither can be. A row that permanently
-- reads "chưa cấu hình URL" is not a status, it is a to-do nobody can do -
-- and it makes the source table look neglected rather than honest.
--
-- The two BLOCKED sources are deliberately kept: kwookvietnam.com.vn answers
-- a bot challenge and marketplace.tripmap.vn returns 403. Both are real,
-- reachable sites that refuse a datacentre IP, both auto-deactivated after
-- three consecutive failures, and that is the three-strikes rule doing its
-- job on live evidence. Deleting those would hide a true finding.
--
-- Close out the abandoned sweep row this schema change is shipping alongside,
-- so the dashboard stops showing a 0-listing run as "đang chạy" forever.
update sweeps
   set finished_at = now(),
       errors = '[{"stage":"aborted","error":"interrupted; a newer sweep run replaced it"}]'::jsonb
 where finished_at is null
   and started_at < now() - interval '30 minutes';

delete from listing_urls where source_id in ('lotte', 'vietmart');
delete from sources      where id        in ('lotte', 'vietmart');
