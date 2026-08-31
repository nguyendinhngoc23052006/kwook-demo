-- Where the model's output lands. It PROPOSES; it does not resolve.
--
-- Kept in its own table rather than written onto listing_urls on purpose:
-- a proposal is an opinion with a confidence, and the moment it is written
-- into product_sku it becomes indistinguishable from an exact alias match.
-- Keeping them apart is what lets the dashboard say who decided what.
create table if not exists resolution_proposals (
  id             uuid primary key default gen_random_uuid(),
  listing_url_id uuid not null references listing_urls(id),
  sweep_id       uuid references sweeps(id),
  title_seen     text not null,
  proposed_sku   text references products(sku),   -- null = the model declined
  confidence     numeric,
  reasoning      text,
  model          text not null,
  created_at     timestamptz not null default now(),
  unique (listing_url_id)
);

alter table resolution_proposals enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'resolution_proposals' and policyname = 'anon_read'
  ) then
    create policy anon_read on resolution_proposals for select to anon using (true);
  end if;
end $$;
