# GIÁ SÀN

Channel price-integrity monitoring for **Kwook Việt Nam**.

Every hour, without anyone touching it, GIÁ SÀN reads the marketplace listings
for Kwook's products, records what it saw, compares that against what it saw
before, and writes down anything that looks wrong. The result is a dashboard
that answers one question a brand owner cannot otherwise answer quickly: *is
my own product competing against itself, and at what price?*

## What it found

These are live findings from the running system, not examples.

**One product, five listings, one seller, a 141,7% spread.** The same
"rong biển cuộn cơm 100 lá" is on sale at 120.000 đ and at 290.000 đ
simultaneously, from the same store:

| Listing | Price | Đã bán | Đánh giá |
|---|---:|---:|---:|
| K-wook nhập khẩu Hàn Quốc | 120.000 đ | 190 | 218 |
| Hàn Quốc 100 lá 250g CÓ ZIP | 185.000 đ | 122 | 187 |
| 100 lá | 185.000 đ | 910 | 1.240 |
| K-WOOK cao cấp | 210.000 đ | 256 | 978 |
| 100 Lá Hàn Quốc | 290.000 đ | — | — |

A buyer comparing these picks 120.000 đ. The other four listings are not
competing with a rival — they are competing with the same company's own
inventory, and the 290.000 đ listing has no sales at all.

**Two listings advertise a discount that was never real.** A 400g pack sells
at 159.000 đ against a struck-through 1.250.000 đ — a 7,9× anchor. A Yaki 50
Lá sells at 115.000 đ against 850.000 đ, 7,4×. No pack of either product has
been observed anywhere near those anchors.

**Six listings show a strike-through price *below* the selling price** — a
broken discount display advertising a "discount" that costs more than the real
price.

## How it works

```
GitHub Actions (one run: four sweeps at :05 past the hour, then it
      │          starts the next run)
      │  fetch → parse → scope → resolve → detect → propose → explain
      ▼
  Supabase Postgres  ──────────►  Cloudflare Pages
  (8 tables, RLS)                 (React dashboard, reads directly)
```

Four moving parts, all on free tiers:

- **GitHub Actions** runs the sweep and gates every merge. Minutes are free and
  unmetered on a public repo, so the scraping, parsing and detecting all live
  here. The `schedule` event is best-effort — GitHub documents it as delayed
  under load and droppable, and it left this repo 126- and 193-minute holes —
  so each sweep run books its own successor instead. The only cron lives in
  `sweep-watchdog.yml`, which restarts the chain **only when no sweep is
  running**; a cron on the sweep itself would cancel the healthy run twice an
  hour.
- **Supabase Postgres** stores everything. Schema changes are migration files
  in `supabase/migrations/`; the database is never edited by hand.
- **Cloudflare Pages** serves the dashboard, deployed by its GitHub
  integration on every push, with a preview URL per pull request.
- **Vite + React + TypeScript** for the dashboard itself.

### The sweep

A source is read in one of three ways, and two of them return many products
per request. `store_index` parses a store page's product grid — one fetch to
kitbuy returns all 29 of its listings. `catalog_json` reads a shop's own
public JSON catalogue; Shopify, Sapo/Bizweb and WooCommerce all publish one,
already structured, so there is no markup to break. `single_page` reads one
product page through its JSON-LD, meta tags or WooCommerce markup.

Only URLs marked `is_entry_point` are fetched. The rest are products a parse
discovered, and re-fetching those would re-read pages the sweep already has.
None of it uses a model, so an hourly cadence costs nothing and cannot drift
between runs. A model is used twice per sweep, both times after the rules have
finished — once on the residue they could not resolve, once to put the
findings they produced into Vietnamese (see **Where the model is used** below).

Parsing marketplace HTML has two traps this handles explicitly:

- **`.` is a thousands separator in Vietnamese.** `parseFloat("42.120")`
  returns `42.12` — a 1000× error that renders as a plausible price. Prices
  are parsed by stripping non-digits, never by `parseFloat`.
- **`đ` is a distinct letter, not `d` + a combining mark.** Unicode NFD
  decomposition leaves it intact, so title normalisation replaces it
  explicitly before stripping diacritics.

### The detectors

Seven pure functions in `src/sweep/detect.ts` — arrays in, findings out, no
I/O and no model, which is what makes them testable.

| Detector | Fires when |
|---|---|
| `self_cannibalization` | one SKU, one seller, prices spread beyond 25% |
| `dispersion` | spread across *different* sellers exceeds the threshold |
| `floor_breach` | a price drops below the SKU's configured floor |
| `fake_anchor` | the struck-through price is implausible against the real one |
| `dead_listing` | no units sold in 24h *while a sibling listing is selling* |
| `new_seller` | a listing appears that was not in the previous sweep |
| `attribution_loss` | a listing carries no recognisable brand string |

Two of these encode a judgment worth stating:

`dead_listing` uses a **time** window, not a sweep count. At an hourly cadence
"no growth in three sweeps" means three hours, which would mark almost
everything dead. It also requires a sibling of the same SKU to be selling —
without that guard, a quiet market would flag every listing at once.

`attribution_loss` is **deliberately not run**. The source's cards carry no
brand field, so every listing would score as a finding every hour. A detector
that always fires is noise, not signal.

### Where the model is used

Twice per sweep, both times last, and never on anything a rule can decide.

Everything above is deterministic: regex parsing, an explicit competitor-brand
filter, exact alias matching, arithmetic thresholds. Two jobs remain that rules
are genuinely bad at, and the model does exactly those two. Both calls share one
hardened transport in `src/sweep/gemini.ts` — runtime model discovery, a retry
on 429/503, and a walk down to an older model when the newest is overloaded.

**1. Deciding whether a marketplace title names a product in the catalogue.**
Exact matching is why `"Rong biển vụn rắc cơm GÓI TO 300g, 400g"` sat unresolved
through every sweep: it names two pack sizes, so no alias equals it and no
threshold helps.

`src/sweep/propose.ts` sends that residue — unresolved, in-scope titles only —
to Gemini (free tier, REST, no SDK) with the catalogue, and writes the answers
to `resolution_proposals` for a human to accept or reject. Three properties make
it safe to run on a schedule:

- **It proposes; it never writes a match.** No `product_sku` changes without a
  person clicking accept.
- **It is allowed to refuse.** On its first live run all six proposals came back
  `null` with reasoning, including the case above: *"Tiêu đề chứa đồng thời hai
  quy cách 300g và 400g nên không khớp SKU cụ thể."*
- **Its output is untrusted input.** The response is parsed with a zod schema;
  anything off-shape is discarded, and a model outage records an error on the
  sweep rather than failing it.

It also catches things a rule would not: a Shopee **shop header** that the
parser had recorded as a listing showed up in the proposals as "not a product".

**2. Saying what a finding means to the person who has to act on it.**

`src/sweep/explain.ts` runs after every event is written and adds one Vietnamese
sentence per finding to `events.explanation`. The detectors produce arithmetic —
`dispersion, KW-VUN-400, +44,0%`. The dashboard used to bridge that with one
fixed sentence per detector type: accurate, identical on every row of that type,
and therefore skimmed past.

The same three properties hold, for the same reasons. It runs **last**, so a
finding exists whether or not the model answers. It writes **prose only** — it
cannot change which findings fired, their severity, or a single number; the
worst a bad sentence can do is read badly beside numbers that are still right.
And it may **refuse**: a finding it omits keeps the static wording, so an outage
degrades the dashboard to exactly what it showed before this existed.

Numbers are formatted by code *before* the model sees them and are never asked
for back. It is handed `160.000 – 699.000 đ (+336.9%)` and asked to explain it —
a model restating a price is a model that can restate it wrong.

### The dashboard

Five screens, all reading the latest sweep:

- **Bảng giá** — listings grouped by SKU, worst spread first.
- **Cảnh báo** — findings, each with a sentence written for that finding.
- **Diễn biến** — what changed between sweeps, and the log of every run.
- **Nguồn** — per-source health, including the three-strikes deactivation.
- **Chưa khớp** — listings the resolver could not tie to a product.

## Design decisions worth defending

**A SKU with one priced listing reports "không tính được", not 0%.**
Dispersion across a single point is not zero dispersion. Rendering it as a
number tells the reader the SKU is healthy when in fact it was never measured.

**Unresolved listings are shown, never dropped.** An unresolved listing is the
one place a silent miss can hide a real pricing problem, so it stays visible in
*Chưa khớp* until someone claims it. Currently 24 of 29, because the product
catalogue is seeded with 2 SKUs — that number falling is the measure of
progress, and it is visible rather than hidden.

**A price going from a number to `null` counts as a change.** Silently
dropping it would hide a parser regression, which is the failure this system
should catch first.

**A units-sold counter going *down* does not count as a sale.** The
marketplace counter is cumulative, so a drop is a relist or a reset.

**History reads a bounded 24 sweeps.** PostgREST caps a response at 1000 rows
by default; truncated history would read as *gaps*, making the differ report
moves that never happened. The bound is correctness, not performance.

**The publishable Supabase key is committed.** It is inlined into the bundle
that every visitor downloads, so committing it gives away nothing; RLS is the
actual guard — `anon` SELECT on all eight tables and no write policy anywhere.
The **secret** key exists only as a repository secret used by the sweep.

## Operating it

Everything is a dashboard click or a pasted prompt; no local setup and no
terminal is required.

- **Run a sweep now** — Actions → `sweep` → Run workflow.
- **Change the schema** — add a migration file under `supabase/migrations/`;
  `migrate.yml` applies it on merge. Never edit the database by hand.
- **Add a product** — a migration seeding `products` with its `aliases`. The
  next sweep resolves matching listings automatically.
- **Add a source** — a row in `sources` plus a fetch strategy.
- **A sweep failure opens a GitHub issue** rather than failing silently.

CI runs `tests`, `lint`, and `typecheck` on every pull request.

## Status

Built and running. Not yet done:

- The catalogue holds 14 SKUs. A sweep observes 42 listings across 7 active
  sources and writes 11 findings.
- Nine sources are configured; seven sweep cleanly (kitbuy, abby, tiki,
  cphfood, hunglongmart, thitruongsi, tteokbokki). Two — Kwook's own site and
  a Tripmap aggregator page — answer scrapers with a challenge page and
  deactivated themselves after three failures each. That is the honest state
  of the market, not a gap in the code.
- **Most shops selling this brand cannot be read at all.** Nineteen domains
  and seven product pages were probed on a runner and yielded nothing: most
  are on platforms with no public catalogue, two render prices in the browser
  the way Shopee does, the rest refused or were unreachable. Every one is
  recorded in `supabase/migrations/20260902200000_entry_points_and_catalogue.sql`
  so the search is not repeated.
- **abby is deliberately not read through its catalogue API.** That API
  reports prices excluding tax — 10.000 đ where its own product page shows
  10.800 đ, exactly 1,08× — and carries no tax-inclusive field. Ingesting it
  would manufacture an 8% dispersion finding out of nothing, which is the
  exact defect this tool exists to detect.
- **No reference price exists yet, and it was looked for.** Kwook publishes no
  retail price list anywhere reachable — their own site and official Shopee
  store both refuse scrapers, and nothing else quotes a "giá niêm yết". The
  only prices found were other resellers' and B2B wholesale ones, which are
  not a brand floor: the same 100-lá pack appears at 195.000, 295.000 and
  300.000 đ on one wholesale marketplace. Seeding any of those would put a
  fiction on the dashboard and report violations against it, so
  `reference_price_vnd` stays null for all 14 products and `floor_breach` has
  never fired. Every finding shown comes from comparing listings against each
  other. A price list from Kwook would close this in one migration.
- An **Đánh giá** screen scoring detector precision against labelled fixtures
  is planned.
