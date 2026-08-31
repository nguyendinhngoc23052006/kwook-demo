-- Alert wording, written per finding instead of per detector type.
--
-- The dashboard has always shown one fixed sentence per detector: accurate,
-- identical on every row, and therefore skimmed past. These columns hold a
-- sentence about THIS finding - this product, this seller, these two numbers.
--
-- Deliberately nullable with no default. A null explanation is the normal
-- state for a sweep that ran without a model (no key, an outage, a refusal),
-- and the dashboard falls back to the static wording it already had. Nothing
-- downstream may treat a null here as an error.
--
-- explained_by records WHICH model wrote it. Gemini model names rotate, so
-- "which model said this" is not reconstructible after the fact, and an
-- explanation whose author is unknown is not auditable.
alter table events add column if not exists explanation  text;
alter table events add column if not exists explained_by text;

comment on column events.explanation is
  'One Vietnamese sentence about this specific finding, written by a model. Null means use the static per-type wording.';
comment on column events.explained_by is
  'The model that wrote explanation, e.g. gemini-3.6-flash. Null when no model ran.';
