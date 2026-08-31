import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import type { ListingRow } from "./group.js";
import type { Snapshot } from "./history.js";

export type Sweep = {
  id: string;
  started_at: string;
  finished_at: string | null;
  sources_ok: number;
  sources_attempted: number;
  listings_observed: number;
  errors: SweepError[];
};

/** What run.ts writes into sweeps.errors: a per-source failure, or an abort. */
export type SweepError = {
  stage?: string;
  source?: string;
  url?: string;
  error?: string;
};

/** A run that was replaced mid-fetch. Not running, and not a real result. */
export function wasInterrupted(s: Sweep): boolean {
  return Array.isArray(s.errors) && s.errors.some((e) => e?.stage === "aborted");
}

export type Product = { sku: string; name_canonical: string; reference_price_vnd: number | null };

export type EventRow = {
  id: string;
  type: string;
  severity: string;
  product_sku: string | null;
  listing_url_id: string | null;
  old_value: string | null;
  new_value: string | null;
};

export type Source = {
  id: string;
  display_name: string;
  domain: string;
  active: boolean;
  consecutive_failures: number;
  last_success_at: string | null;
};

export type Proposal = {
  listing_url_id: string;
  proposed_sku: string | null;
  confidence: number | null;
  reasoning: string | null;
  model: string;
};

export type Dashboard = {
  sweep: Sweep | null;
  /** Newest first. Bounded so the page stays one small fetch, not a full archive. */
  sweepHistory: Sweep[];
  history: Snapshot[];
  listings: ListingRow[];
  products: Product[];
  events: EventRow[];
  sources: Source[];
  /** How many entry-point URLs each source has. Zero means nothing to fetch. */
  urlsBySource: Record<string, number>;
  /** Model proposals for listings exact matching could not place. */
  proposals: Proposal[];
};

/**
 * How far back the history screen reads — a day at the hourly cadence.
 *
 * The bound is not cosmetic. PostgREST caps a response at 1000 rows by
 * default, and a truncated history does not merely show less: the missing
 * rows read as gaps, so changesBetween would compare across them and invent
 * moves that never happened. 24 sweeps x 29 listings leaves headroom under
 * that cap. If the catalogue grows past ~40 listings, lower this or page the
 * query — do not just raise it.
 */
const HISTORY_SWEEPS = 24;

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: Dashboard };

/** A joined observation row as PostgREST returns it. */
type ObservationJoin = {
  listing_url_id: string;
  title_seen: string | null;
  price_vnd: number | null;
  original_price_vnd: number | null;
  units_sold: number | null;
  review_count: number | null;
  listing_urls: {
    url: string;
    product_sku: string | null;
    source_id: string;
    out_of_scope: boolean | null;
    out_of_scope_brand: string | null;
  } | null;
};

export function useDashboard(): State {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      const sweepRes = await supabase
        .from("sweeps")
        .select("id,started_at,finished_at,sources_ok,sources_attempted,listings_observed,errors")
        .order("started_at", { ascending: false })
        .limit(HISTORY_SWEEPS);
      if (sweepRes.error) throw new Error(sweepRes.error.message);

      const sweepHistory = sweepRes.data as Sweep[];
      const sweep = sweepHistory[0] ?? null;

      // Products and sources describe the setup, so they load even with no sweep
      // yet — that empty state should still show what is being watched.
      const [productsRes, sourcesRes, urlsRes, proposalsRes] = await Promise.all([
        supabase.from("products").select("sku,name_canonical,reference_price_vnd"),
        supabase
          .from("sources")
          .select("id,display_name,domain,active,consecutive_failures,last_success_at")
          .order("id"),
        supabase.from("listing_urls").select("source_id"),
        supabase
          .from("resolution_proposals")
          .select("listing_url_id,proposed_sku,confidence,reasoning,model"),
      ]);
      if (productsRes.error) throw new Error(productsRes.error.message);
      if (sourcesRes.error) throw new Error(sourcesRes.error.message);
      if (urlsRes.error) throw new Error(urlsRes.error.message);
      if (proposalsRes.error) throw new Error(proposalsRes.error.message);

      const urlsBySource: Record<string, number> = {};
      for (const row of urlsRes.data as { source_id: string }[]) {
        urlsBySource[row.source_id] = (urlsBySource[row.source_id] ?? 0) + 1;
      }

      let listings: ListingRow[] = [];
      let events: EventRow[] = [];
      let history: Snapshot[] = [];

      if (sweep) {
        const [obsRes, eventsRes, historyRes] = await Promise.all([
          supabase
            .from("observations")
            .select(
              "listing_url_id,title_seen,price_vnd,original_price_vnd,units_sold,review_count,listing_urls(url,product_sku,source_id,out_of_scope,out_of_scope_brand)",
            )
            .eq("sweep_id", sweep.id),
          supabase
            .from("events")
            .select("id,type,severity,product_sku,listing_url_id,old_value,new_value")
            .eq("sweep_id", sweep.id),
          supabase
            .from("observations")
            .select(
              "listing_url_id,sweep_id,observed_at,title_seen,price_vnd,units_sold,listing_urls(source_id,product_sku)",
            )
            .in(
              "sweep_id",
              sweepHistory.map((s) => s.id),
            ),
        ]);
        if (obsRes.error) throw new Error(obsRes.error.message);
        if (eventsRes.error) throw new Error(eventsRes.error.message);
        if (historyRes.error) throw new Error(historyRes.error.message);
        type HistoryJoin = Omit<Snapshot, "source_id" | "product_sku"> & {
          listing_urls: { source_id: string; product_sku: string | null } | null;
        };
        history = (historyRes.data as unknown as HistoryJoin[]).map((r) => ({
          listing_url_id: r.listing_url_id,
          sweep_id: r.sweep_id,
          observed_at: r.observed_at,
          title_seen: r.title_seen,
          price_vnd: r.price_vnd,
          units_sold: r.units_sold,
          source_id: r.listing_urls?.source_id ?? "?",
          product_sku: r.listing_urls?.product_sku ?? null,
        }));

        listings = (obsRes.data as unknown as ObservationJoin[]).map((o) => ({
          listing_url_id: o.listing_url_id,
          url: o.listing_urls?.url ?? "",
          product_sku: o.listing_urls?.product_sku ?? null,
          source_id: o.listing_urls?.source_id ?? "?",
          title_seen: o.title_seen,
          price_vnd: o.price_vnd,
          original_price_vnd: o.original_price_vnd,
          units_sold: o.units_sold,
          review_count: o.review_count,
          out_of_scope: o.listing_urls?.out_of_scope ?? false,
          out_of_scope_brand: o.listing_urls?.out_of_scope_brand ?? null,
        }));
        events = eventsRes.data as EventRow[];
      }

      if (!cancelled) {
        setState({
          status: "ready",
          data: {
            sweep,
            sweepHistory,
            history,
            listings,
            products: productsRes.data as Product[],
            events,
            sources: sourcesRes.data as Source[],
            urlsBySource,
            proposals: proposalsRes.data as Proposal[],
          },
        });
      }
    }

    load().catch((e: unknown) => {
      if (!cancelled) {
        setState({ status: "error", message: e instanceof Error ? e.message : String(e) });
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
