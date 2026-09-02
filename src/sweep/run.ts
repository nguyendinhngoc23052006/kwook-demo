import { mkdir, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { clean } from "./clean.js";
import { type QueueCandidate, stillListed } from "./current.js";
import type { Observation } from "./detect.js";
import { runDetectors } from "./events.js";
import { explainFindings, type FindingContext } from "./explain.js";
import { fetchPage } from "./fetchSource.js";
import { type SweepError, sweepFailed } from "./outcome.js";
import { type ParsedListing, parseStoreIndex } from "./parse.js";
import { parseCatalog, parseKwookCatalog } from "./parseCatalog.js";
import { looksLikeChallenge, parseProductPage } from "./parseProduct.js";
import { proposeResolutions } from "./propose.js";
import { type Product, resolveByAlias } from "./resolve.js";
import { classifyScope } from "./scope.js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are required");

const db = createClient(url, key, { auth: { persistSession: false } });

type Src = { id: string; fetch_strategy: string; consecutive_failures: number };
type Listing = { id: string; url: string; source_id: string; is_entry_point: boolean };

const errors: SweepError[] = [];

// Close out any sweep left open by an interrupted run.
//
// Concurrency is cancel-in-progress, so exactly one sweep run exists at a
// time: any sweep still open when this one starts was abandoned, not racing
// us. Cancelling during a FETCH rather than during the sleep leaves a row
// with no counts that the dashboard renders as "đang chạy" forever - which
// is how a 0-listing sweep ended up sitting at the top of the log.
const { data: abandoned } = await db
  .from("sweeps")
  .update({
    finished_at: new Date().toISOString(),
    errors: [{ stage: "aborted", error: "interrupted; a newer sweep run replaced it" }],
  })
  .is("finished_at", null)
  .select("id");
if (abandoned && abandoned.length > 0) {
  console.log(`closed ${abandoned.length} abandoned sweep(s)`);
}

const { data: sweep, error: sweepErr } = await db.from("sweeps").insert({}).select().single();
if (sweepErr || !sweep) throw new Error(`could not open a sweep: ${sweepErr?.message}`);
console.log(`sweep ${sweep.id} started`);

const { data: sources } = await db.from("sources").select("*").eq("active", true);
const { data: seeds } = await db.from("listing_urls").select("id,url,source_id,is_entry_point");
const { data: productRows } = await db
  .from("products")
  .select("sku,aliases,reference_price_vnd,name_canonical,net_weight_g,pack_format");
const products = (productRows ?? []) as (Product & { reference_price_vnd: number | null })[];
const referenceBySku = new Map(
  products.flatMap((p) => (p.reference_price_vnd ? [[p.sku, p.reference_price_vnd] as const] : [])),
);

let sourcesOk = 0;
let sourcesAttempted = 0;
// Which sources actually answered this sweep. A listing missing from a source
// we READ is gone; a listing missing from a source we could not read is not.
const sourcesRead = new Set<string>();
let observed = 0;

for (const src of (sources ?? []) as Src[]) {
  // Only entry points. The other rows for a source are products a parse
  // DISCOVERED - fetching those re-reads pages whose contents this sweep
  // already has, and hands a product page to a parser expecting an index.
  const entryPoints = ((seeds ?? []) as Listing[]).filter(
    (l) => l.source_id === src.id && l.is_entry_point,
  );
  if (entryPoints.length === 0) {
    // Not a failure and not an attempt: there is nothing to fetch until this
    // source has an entry point. Counting it as attempted would report it as
    // a broken source forever, which is the opposite of what happened.
    console.log(`${src.id}: no listing urls seeded, skipping`);
    continue;
  }
  sourcesAttempted++;

  let ok = false;

  for (const entry of entryPoints) {
    const res = await fetchPage(entry.url);
    if (!res.ok) {
      console.log(`${src.id}: FAIL ${entry.url} - ${res.error}`);
      errors.push({ source: src.id, url: entry.url, error: res.error });
      continue;
    }

    await mkdir("fixtures/raw", { recursive: true });
    await writeFile(`fixtures/raw/${src.id}.html`, res.html, "utf8");

    const manyPerFetch =
      src.fetch_strategy === "store_index" || src.fetch_strategy === "catalog_json";

    if (manyPerFetch) {
      // One fetch, many products - each gets its own listing_urls row so the
      // per-listing history the detectors need is actually per listing.
      let parsed: ParsedListing[];

      if (src.fetch_strategy === "catalog_json") {
        // A shop's own JSON catalogue. Two counts, because they mean
        // different things: everything the endpoint returned tells us whether
        // it still works, and the Kwook subset is what we keep. A catalogue
        // holds the WHOLE shop, so most of it is other people's groceries.
        const everything = parseCatalog(res.html, entry.url);
        if (everything.length === 0) {
          // Zero products from an endpoint whose whole job is listing them:
          // the shape changed or this is not a catalogue. Not marking `ok`
          // lets the three-strike rule retire it, which is the point.
          console.log(`${src.id}: EMPTY ${entry.url} - no products parsed`);
          errors.push({ source: src.id, url: entry.url, error: "catalogue parsed to 0 products" });
          continue;
        }
        const kwook = parseKwookCatalog(res.html, entry.url);
        console.log(
          `${src.id}: ${entry.url} -> ${everything.length} products, ${kwook.length} Kwook`,
        );
        // A shop that stocks none this hour is healthy and empty, not broken -
        // so `ok` is set on a readable catalogue, not on a non-zero yield.
        ok = true;
        parsed = kwook.map((i) => ({
          itemId: i.sellerSku,
          url: i.url,
          title: i.title,
          priceVnd: i.priceVnd,
          originalPriceVnd: i.originalPriceVnd,
          // The catalogue APIs carry none of these; null is the honest value.
          discountPct: null,
          unitsSold: null,
          reviewCount: null,
        }));
      } else {
        ok = true;
        parsed = parseStoreIndex(res.html);
        console.log(`${src.id}: ${entry.url} -> ${parsed.length} listings parsed`);
      }

      for (const p of parsed) {
        const productUrl = p.url ?? `${entry.url}#${p.title}`;
        // Alias-first, zero tokens. A miss leaves product_sku null and the
        // listing lands in the unresolved queue rather than being guessed at.
        // A listing naming another brand can never match a Kwook SKU, so it
        // is marked rather than left to sit in the queue forever.
        const scope = classifyScope(p.title);
        const hit = scope.outOfScope ? null : resolveByAlias(p.title, products);
        const { data: row, error: urlErr } = await db
          .from("listing_urls")
          .upsert(
            {
              source_id: src.id,
              url: productUrl,
              last_seen_at: new Date().toISOString(),
              product_sku: hit?.sku ?? null,
              resolve_confidence: hit?.confidence ?? null,
              resolved_by: hit?.method ?? null,
              out_of_scope: scope.outOfScope,
              out_of_scope_brand: scope.outOfScope ? scope.brand : null,
              // is_entry_point is deliberately absent. On a new row the column
              // default (false) applies; on an existing one PostgREST leaves
              // the stored value alone, so a discovered product never demotes
              // a URL that is genuinely an entry point.
            },
            { onConflict: "url" },
          )
          .select("id")
          .single();
        if (urlErr || !row) {
          errors.push({ source: src.id, url: productUrl, error: urlErr?.message });
          continue;
        }

        const { error: obsErr } = await db.from("observations").upsert(
          {
            listing_url_id: row.id,
            sweep_id: sweep.id,
            price_vnd: p.priceVnd,
            original_price_vnd: p.originalPriceVnd,
            discount_pct: p.discountPct,
            units_sold: p.unitsSold,
            review_count: p.reviewCount,
            title_seen: p.title,
            in_stock: p.priceVnd !== null,
          },
          { onConflict: "listing_url_id,sweep_id" },
        );
        if (obsErr) errors.push({ source: src.id, url: productUrl, error: obsErr.message });
        else observed++;
      }
    } else {
      // One product page, read through its structured markup rather than a
      // per-site scraper. Raw HTML is still stored: when the parser finds
      // nothing, that excerpt is the only way to see why.
      const p = parseProductPage(res.html);

      // A bot check that answered 200 is not a successful fetch. Recording it
      // as one leaves the source looking healthy while it returns nothing.
      if (looksLikeChallenge(res.html, p)) {
        console.log(`${src.id}: BLOCKED ${entry.url} - challenge page ("${p.title}")`);
        errors.push({ source: src.id, url: entry.url, error: `challenge page: ${p.title}` });
        continue;
      }
      ok = true;

      console.log(
        `${src.id}: ${entry.url} -> ${p.priceVnd ?? "no price"} (${p.method ?? "no structured markup"})`,
      );

      const { error } = await db.from("observations").upsert(
        {
          listing_url_id: entry.id,
          sweep_id: sweep.id,
          price_vnd: p.priceVnd,
          original_price_vnd: p.originalPriceVnd,
          brand_string: p.brandString,
          in_stock: p.priceVnd !== null,
          raw_excerpt: res.html.slice(0, 400_000),
          title_seen: p.title ?? clean(res.html).slice(0, 200),
          extract_confidence: { method: p.method },
        },
        { onConflict: "listing_url_id,sweep_id" },
      );
      if (error) errors.push({ source: src.id, url: entry.url, error: error.message });
      else observed++;
      await db
        .from("listing_urls")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("id", entry.id);
    }

    await new Promise((r) => setTimeout(r, 3000)); // be a polite crawler
  }

  if (ok) {
    sourcesOk++;
    sourcesRead.add(src.id);
    await db
      .from("sources")
      .update({ consecutive_failures: 0, last_success_at: new Date().toISOString() })
      .eq("id", src.id);
  } else {
    const fails = src.consecutive_failures + 1;
    await db
      .from("sources")
      .update({ consecutive_failures: fails, active: fails < 3 })
      .eq("id", src.id);
  }
}

// The one place a model is used, and it runs LAST - only on what exact
// matching could not place, and only on listings without a proposal already.
// It writes an opinion with a confidence; a human confirms it. Nothing here
// changes a price, a finding, or a product_sku.
{
  const { data: pending } = await db
    .from("listing_urls")
    .select("id, url, source_id, last_seen_at")
    .is("product_sku", null)
    .eq("out_of_scope", false);

  const { data: alreadyProposed } = await db.from("resolution_proposals").select("listing_url_id");
  const seen = new Set((alreadyProposed ?? []).map((r) => r.listing_url_id as string));

  // Ghosts are dropped before the model is asked, not after. A listing that
  // no longer appears on a source we read successfully is not a resolution
  // problem - it is gone - and asking about it every hour costs a request and
  // writes a proposal nothing will ever render.
  const live = stillListed(
    (pending ?? []) as (QueueCandidate & { id: string; url: string })[],
    sourcesRead,
    sweep.started_at as string,
  );
  const needed = live.filter((l) => !seen.has(l.id));

  if (needed.length > 0) {
    // The title as last observed - the model reads what the seller wrote.
    const { data: obs } = await db
      .from("observations")
      .select("listing_url_id, title_seen, observed_at")
      .in(
        "listing_url_id",
        needed.map((l) => l.id),
      )
      .order("observed_at", { ascending: false });

    const titleFor = new Map<string, string>();
    for (const o of (obs ?? []) as { listing_url_id: string; title_seen: string | null }[]) {
      if (o.title_seen && !titleFor.has(o.listing_url_id)) {
        titleFor.set(o.listing_url_id, o.title_seen);
      }
    }

    const catalogue = (productRows ?? []).map((p) => ({
      sku: (p as { sku: string }).sku,
      name: (p as { name_canonical?: string }).name_canonical ?? (p as { sku: string }).sku,
      netWeightG: (p as { net_weight_g?: number | null }).net_weight_g ?? null,
      packFormat: (p as { pack_format?: string | null }).pack_format ?? null,
    }));

    const titles = [...titleFor.values()];
    try {
      const { proposals, model } = await proposeResolutions(titles, catalogue);
      const byTitle = new Map(proposals.map((p) => [p.title, p]));

      for (const [listingUrlId, title] of titleFor) {
        const p = byTitle.get(title);
        if (!p) continue;
        const { error } = await db.from("resolution_proposals").upsert(
          {
            listing_url_id: listingUrlId,
            sweep_id: sweep.id,
            title_seen: title,
            proposed_sku: p.proposed_sku,
            confidence: p.confidence,
            reasoning: p.reasoning,
            model,
          },
          { onConflict: "listing_url_id" },
        );
        if (error) errors.push({ stage: "propose", error: error.message });
      }
      console.log(
        `${proposals.length} resolution proposal(s) from ${titles.length} title(s)` +
          (model ? ` via ${model}` : ""),
      );
    } catch (e) {
      // A model outage must never fail a sweep: the observations are the
      // product, the proposals are an assist.
      const message = e instanceof Error ? e.message : String(e);
      console.log(`resolution proposals skipped: ${message}`);
      errors.push({ stage: "propose", error: message });
    }
  }
}

// Derived, never observed: run the detectors over this sweep and the last.
const { data: prevSweep } = await db
  .from("sweeps")
  .select("id")
  .neq("id", sweep.id)
  .order("started_at", { ascending: false })
  .limit(1)
  .maybeSingle();

async function loadObservations(sweepId: string): Promise<Observation[]> {
  const { data } = await db
    .from("observations")
    .select(
      "listing_url_id,price_vnd,original_price_vnd,units_sold,brand_string,title_seen,observed_at,listing_urls(source_id,product_sku)",
    )
    .eq("sweep_id", sweepId);
  type Row = {
    listing_url_id: string;
    price_vnd: number | null;
    original_price_vnd: number | null;
    units_sold: number | null;
    brand_string: string | null;
    title_seen: string | null;
    observed_at: string;
    listing_urls: { source_id: string; product_sku: string | null } | null;
  };
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    listingUrlId: r.listing_url_id,
    sellerId: r.listing_urls?.source_id ?? "unknown",
    productSku: r.listing_urls?.product_sku ?? null,
    title: r.title_seen ?? "",
    priceVnd: r.price_vnd,
    originalPriceVnd: r.original_price_vnd,
    unitsSold: r.units_sold,
    brandString: r.brand_string,
    observedAt: r.observed_at,
  }));
}

const currentObs = await loadObservations(sweep.id);
const previousObs = prevSweep ? await loadObservations(prevSweep.id) : [];
const findings = runDetectors(currentObs, previousObs, referenceBySku);

if (findings.length > 0) {
  const { data: written, error: evErr } = await db
    .from("events")
    .insert(
      findings.map((f) => ({
        sweep_id: sweep.id,
        type: f.type,
        severity: f.severity,
        product_sku: f.productSku,
        listing_url_id: f.listingUrlId,
        old_value: f.oldValue,
        new_value: f.newValue,
        rule_id: f.type,
      })),
    )
    .select("id,type,severity,product_sku,listing_url_id,old_value,new_value");
  if (evErr) errors.push({ stage: "events", error: evErr.message });

  // The second model call, and the last thing in the sweep.
  //
  // Every finding above is already written and already correct. This only
  // adds prose to events.explanation - it cannot change which findings fired,
  // their severity, or a single number. A failure here leaves the static
  // per-type wording the dashboard has always shown.
  if (written && written.length > 0) {
    try {
      const nameBySku = new Map(
        (productRows ?? []).map((p) => [
          (p as { sku: string }).sku,
          (p as { name_canonical?: string }).name_canonical ?? (p as { sku: string }).sku,
        ]),
      );
      const obsById = new Map(currentObs.map((o) => [o.listingUrlId, o]));

      type EventRow = {
        id: string;
        type: string;
        severity: string;
        product_sku: string | null;
        listing_url_id: string | null;
        old_value: string | null;
        new_value: string | null;
      };

      const context: FindingContext[] = (written as EventRow[]).map((e) => {
        const obs = e.listing_url_id ? obsById.get(e.listing_url_id) : undefined;
        // Name the thing a person would recognise: the product where the
        // finding is about a SKU, the listing's own title where it is about
        // one listing. A bare id would make the sentence useless.
        const subject = e.product_sku
          ? `${e.product_sku} — ${nameBySku.get(e.product_sku) ?? e.product_sku}`
          : (obs?.title ?? "(listing không rõ)");
        return {
          id: e.id,
          type: e.type,
          severity: e.severity,
          subject,
          seller: obs?.sellerId ?? null,
          oldValue: e.old_value,
          newValue: e.new_value,
        };
      });

      const { explanations, model } = await explainFindings(context);
      for (const [id, text] of explanations) {
        const { error } = await db
          .from("events")
          .update({ explanation: text, explained_by: model })
          .eq("id", id);
        if (error) errors.push({ stage: "explain", error: error.message });
      }
      if (model) {
        console.log(`${explanations.size}/${context.length} alert(s) explained via ${model}`);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.log(`alert explanations skipped: ${message}`);
      errors.push({ stage: "explain", error: message });
    }
  }
}
console.log(`${findings.length} finding(s) from ${currentObs.length} observations`);

await db
  .from("sweeps")
  .update({
    finished_at: new Date().toISOString(),
    sources_attempted: sourcesAttempted,
    sources_ok: sourcesOk,
    listings_observed: observed,
    errors,
  })
  .eq("id", sweep.id);

console.log(
  `sweep ${sweep.id} done: ${sourcesOk}/${sourcesAttempted} sources ok ` +
    `(${(sources ?? []).length - sourcesAttempted} not configured), ${observed} listings`,
);
if (errors.length) {
  console.log(`${errors.length} issue(s) recorded:`, JSON.stringify(errors, null, 2));
}

// Exit on what the sweep failed to DO, not on everything it noticed. The
// hourly chain is handed off by this process's own run, so a non-zero exit
// here is what stops the clock - see outcome.ts for why that distinction had
// to be drawn.
const fatal = sweepFailed(errors, { sourcesAttempted, sourcesOk });
if (fatal) {
  console.error(`sweep failed: ${fatal}`);
  process.exit(1);
}
