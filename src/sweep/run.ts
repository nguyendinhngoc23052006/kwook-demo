import { mkdir, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { clean } from "./clean.js";
import type { Observation } from "./detect.js";
import { runDetectors } from "./events.js";
import { fetchPage } from "./fetchSource.js";
import { parseStoreIndex } from "./parse.js";
import { looksLikeChallenge, parseProductPage } from "./parseProduct.js";
import { type Product, resolveByAlias } from "./resolve.js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are required");

const db = createClient(url, key, { auth: { persistSession: false } });

type Src = { id: string; fetch_strategy: string; consecutive_failures: number };
type Listing = { id: string; url: string; source_id: string };

const errors: unknown[] = [];

const { data: sweep, error: sweepErr } = await db.from("sweeps").insert({}).select().single();
if (sweepErr || !sweep) throw new Error(`could not open a sweep: ${sweepErr?.message}`);
console.log(`sweep ${sweep.id} started`);

const { data: sources } = await db.from("sources").select("*").eq("active", true);
const { data: seeds } = await db.from("listing_urls").select("id,url,source_id");
const { data: productRows } = await db.from("products").select("sku,aliases,reference_price_vnd");
const products = (productRows ?? []) as (Product & { reference_price_vnd: number | null })[];
const referenceBySku = new Map(
  products.flatMap((p) => (p.reference_price_vnd ? [[p.sku, p.reference_price_vnd] as const] : [])),
);

let sourcesOk = 0;
let sourcesAttempted = 0;
let observed = 0;

for (const src of (sources ?? []) as Src[]) {
  const entryPoints = ((seeds ?? []) as Listing[]).filter((l) => l.source_id === src.id);
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

    if (src.fetch_strategy === "store_index") {
      ok = true;
      // One fetch, many products - each gets its own listing_urls row so the
      // per-listing history the detectors need is actually per listing.
      const parsed = parseStoreIndex(res.html);
      console.log(`${src.id}: ${entry.url} -> ${parsed.length} listings parsed`);

      for (const p of parsed) {
        const productUrl = p.url ?? `${entry.url}#${p.title}`;
        // Alias-first, zero tokens. A miss leaves product_sku null and the
        // listing lands in the unresolved queue rather than being guessed at.
        const hit = resolveByAlias(p.title, products);
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
  const { error: evErr } = await db.from("events").insert(
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
  );
  if (evErr) errors.push({ stage: "events", error: evErr.message });
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
  console.log(`${errors.length} error(s):`, JSON.stringify(errors, null, 2));
  process.exit(1);
}
