import { mkdir, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { clean, splitListings } from "./clean.js";
import { fetchPage } from "./fetchSource.js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are required");

const db = createClient(url, key, { auth: { persistSession: false } });

type Src = { id: string; fetch_strategy: string; active: boolean; consecutive_failures: number };
type Listing = { id: string; url: string; source_id: string };

const errors: unknown[] = [];

const { data: sweep, error: sweepErr } = await db.from("sweeps").insert({}).select().single();
if (sweepErr || !sweep) throw new Error(`could not open a sweep: ${sweepErr?.message}`);
console.log(`sweep ${sweep.id} started`);

const { data: sources } = await db.from("sources").select("*").eq("active", true);
const { data: listings } = await db.from("listing_urls").select("id,url,source_id");

let sourcesOk = 0;
let observed = 0;

for (const src of (sources ?? []) as Src[]) {
  const mine = ((listings ?? []) as Listing[]).filter((l) => l.source_id === src.id);
  if (mine.length === 0) {
    console.log(`${src.id}: no listing urls seeded, skipping`);
    continue;
  }

  let sourceHadSuccess = false;

  for (const listing of mine) {
    const res = await fetchPage(listing.url);
    if (!res.ok) {
      console.log(`${src.id}: FAIL ${listing.url} - ${res.error}`);
      errors.push({ source: src.id, url: listing.url, error: res.error });
      continue;
    }
    sourceHadSuccess = true;

    // Keep the untouched HTML for this run. clean() is lossy - it drops the
    // sale price whenever a strikethrough anchor is present - so the parser is
    // built and tested against raw markup, not against cleaned text.
    // Not a dotted directory: upload-artifact@v4 defaults to
    // include-hidden-files: false and skips it without failing the step.
    await mkdir("fixtures/raw", { recursive: true });
    await writeFile(`fixtures/raw/${src.id}.html`, res.html, "utf8");

    const text = clean(res.html);
    // A store index yields many blocks from one fetch; a single page yields one.
    const blocks =
      src.fetch_strategy === "store_index" ? splitListings(text) : [text.slice(0, 8000)];
    console.log(`${src.id}: ${listing.url} -> ${blocks.length} block(s), ${text.length} chars`);

    // Night one stores cleaned text only. Extraction backfills over raw_excerpt
    // once extract.ts lands, so nothing observed tonight is wasted.
    const { error } = await db.from("observations").upsert(
      {
        listing_url_id: listing.id,
        sweep_id: sweep.id,
        raw_excerpt: blocks.join("\n---\n").slice(0, 200_000),
        title_seen: blocks[0]?.slice(0, 200) ?? null,
      },
      { onConflict: "listing_url_id,sweep_id" },
    );
    if (error) errors.push({ source: src.id, url: listing.url, error: error.message });
    else observed += blocks.length;

    await db
      .from("listing_urls")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", listing.id);
    await new Promise((r) => setTimeout(r, 3000)); // be a polite crawler
  }

  if (sourceHadSuccess) {
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

await db
  .from("sweeps")
  .update({
    finished_at: new Date().toISOString(),
    sources_attempted: (sources ?? []).length,
    sources_ok: sourcesOk,
    listings_observed: observed,
    errors,
  })
  .eq("id", sweep.id);

console.log(
  `sweep ${sweep.id} done: ${sourcesOk}/${(sources ?? []).length} sources ok, ${observed} listings`,
);
if (errors.length) {
  console.log(`${errors.length} error(s):`, JSON.stringify(errors, null, 2));
  process.exit(1);
}
