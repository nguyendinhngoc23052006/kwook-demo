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
  /** Written per finding by a model. Null falls back to the static wording. */
  explanation: string | null;
  explained_by: string | null;
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
  entryPointsBySource: Record<string, number>;
  /** Model proposals for listings exact matching could not place. */
  proposals: Proposal[];
  /** What the sweep was configured to check, so the screen can say so. */
  rules: DetectorRule[];
};

/** A detector as the rules table defines it — the sweep reads the same row. */
export type DetectorRule = {
  type: string;
  severity: string;
  active: boolean;
};

/**
 * How far back the history screen reads — a day at the hourly cadence.
 *
 * This is now a display choice rather than a safety limit. It used to be
 * both, and the second job was the dangerous one: PostgREST caps a response
 * at 1000 rows, and a truncated history does not merely show less — the
 * missing rows read as gaps, so changesBetween compares across them and
 * reports price moves that never happened.
 *
 * That bound was hand-fitted to a catalogue of 29 listings and left to rot.
 * The catalogue reached 42, which put this query at 987 of the 1000 rows —
 * thirteen short of inventing prices on screen, with no test and no error to
 * announce it. readHistory below pages instead, so the cap cannot be reached
 * at any catalogue size and this number can be changed freely again.
 */
const HISTORY_SWEEPS = 24;

/** PostgREST's default ceiling on one response. */
const PAGE_ROWS = 1000;

/**
 * How long any one query may take before the screen admits defeat.
 *
 * Without this a slow or unreachable Supabase leaves the page on "Đang tải…"
 * for as long as the browser's own network timeout allows - minutes, with no
 * spinner, no message and nothing to distinguish it from a page that is
 * simply broken. In front of an audience that silence is the failure, whether
 * or not the database eventually answers. Twelve seconds is far longer than a
 * healthy round trip and far shorter than an interview's patience.
 */
const QUERY_TIMEOUT_MS = 12_000;

/** The reason shown when it does. */
export const TIMEOUT_MESSAGE =
  "Máy chủ dữ liệu không phản hồi trong 12 giây. Có thể do mạng — hãy tải lại trang.";

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

type HistoryJoin = Omit<Snapshot, "source_id" | "product_sku"> & {
  listing_urls: { source_id: string; product_sku: string | null } | null;
};

/**
 * Every history row for these sweeps, read a page at a time.
 *
 * Ordered by (observed_at, listing_url_id) because paging without a total
 * order is not paging: rows can repeat or vanish between pages when the
 * server is free to choose a different order each time. The pair is unique
 * per row, so the sequence is stable.
 *
 * A page shorter than the limit is the last page — that is the only stop
 * condition, so growth in the catalogue costs another request rather than
 * silently costing rows.
 */
async function readHistory(sweepIds: string[]): Promise<HistoryJoin[]> {
  const rows: HistoryJoin[] = [];
  for (let from = 0; ; from += PAGE_ROWS) {
    const { data, error } = await supabase
      .from("observations")
      .select(
        "listing_url_id,sweep_id,observed_at,title_seen,price_vnd,units_sold,listing_urls(source_id,product_sku)",
      )
      .in("sweep_id", sweepIds)
      .order("observed_at", { ascending: true })
      .order("listing_url_id", { ascending: true })
      .range(from, from + PAGE_ROWS - 1)
      .abortSignal(AbortSignal.timeout(QUERY_TIMEOUT_MS));
    if (error) throw new Error(error.message);
    const page = (data ?? []) as unknown as HistoryJoin[];
    rows.push(...page);
    if (page.length < PAGE_ROWS) return rows;
  }
}

export function useDashboard(): State {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      const sweepRes = await supabase
        .from("sweeps")
        .select("id,started_at,finished_at,sources_ok,sources_attempted,listings_observed,errors")
        .order("started_at", { ascending: false })
        .limit(HISTORY_SWEEPS)
        .abortSignal(AbortSignal.timeout(QUERY_TIMEOUT_MS));
      if (sweepRes.error) throw new Error(sweepRes.error.message);

      const sweepHistory = sweepRes.data as Sweep[];
      const sweep = sweepHistory[0] ?? null;

      // Products and sources describe the setup, so they load even with no sweep
      // yet — that empty state should still show what is being watched.
      const [productsRes, sourcesRes, urlsRes, rulesRes, proposalsRes] = await Promise.all([
        supabase
          .from("products")
          .select("sku,name_canonical,reference_price_vnd")
          .abortSignal(AbortSignal.timeout(QUERY_TIMEOUT_MS)),
        supabase
          .from("sources")
          .select("id,display_name,domain,active,consecutive_failures,last_success_at")
          .order("id")
          .abortSignal(AbortSignal.timeout(QUERY_TIMEOUT_MS)),
        supabase
          .from("listing_urls")
          .select("source_id,is_entry_point")
          .abortSignal(AbortSignal.timeout(QUERY_TIMEOUT_MS)),
        supabase
          .from("rules")
          .select("type,severity,active")
          .order("type")
          .abortSignal(AbortSignal.timeout(QUERY_TIMEOUT_MS)),
        supabase
          .from("resolution_proposals")
          .select("listing_url_id,proposed_sku,confidence,reasoning,model")
          .abortSignal(AbortSignal.timeout(QUERY_TIMEOUT_MS)),
      ]);
      if (productsRes.error) throw new Error(productsRes.error.message);
      if (sourcesRes.error) throw new Error(sourcesRes.error.message);
      if (urlsRes.error) throw new Error(urlsRes.error.message);
      if (rulesRes.error) throw new Error(rulesRes.error.message);
      if (proposalsRes.error) throw new Error(proposalsRes.error.message);

      // Two counts, because a source has two different numbers and only one of
      // them answers "is this configured?".
      //
      // An ENTRY POINT is a URL the sweep fetches. Everything else in this
      // table is a product some parse discovered - kitbuy has one entry point
      // and twenty-nine discovered products. Judging configuration by the
      // total would call a source healthy when it has products on record and
      // nothing left to fetch them with, which is precisely the state that
      // stops it being swept.
      const entryPointsBySource: Record<string, number> = {};
      const urlsBySource: Record<string, number> = {};
      for (const row of urlsRes.data as { source_id: string; is_entry_point: boolean }[]) {
        urlsBySource[row.source_id] = (urlsBySource[row.source_id] ?? 0) + 1;
        if (row.is_entry_point) {
          entryPointsBySource[row.source_id] = (entryPointsBySource[row.source_id] ?? 0) + 1;
        }
      }

      let listings: ListingRow[] = [];
      let events: EventRow[] = [];
      let history: Snapshot[] = [];

      if (sweep) {
        const [obsRes, eventsRes, historyRows] = await Promise.all([
          supabase
            .from("observations")
            .select(
              "listing_url_id,title_seen,price_vnd,original_price_vnd,units_sold,review_count,listing_urls(url,product_sku,source_id,out_of_scope,out_of_scope_brand)",
            )
            .eq("sweep_id", sweep.id)
            .abortSignal(AbortSignal.timeout(QUERY_TIMEOUT_MS)),
          supabase
            .from("events")
            .select(
              "id,type,severity,product_sku,listing_url_id,old_value,new_value,explanation,explained_by",
            )
            .eq("sweep_id", sweep.id)
            .abortSignal(AbortSignal.timeout(QUERY_TIMEOUT_MS)),
          readHistory(sweepHistory.map((s) => s.id)),
        ]);
        if (obsRes.error) throw new Error(obsRes.error.message);
        if (eventsRes.error) throw new Error(eventsRes.error.message);
        history = historyRows.map((r) => ({
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
            entryPointsBySource,
            proposals: proposalsRes.data as Proposal[],
            rules: rulesRes.data as DetectorRule[],
          },
        });
      }
    }

    load().catch((e: unknown) => {
      if (cancelled) return;
      const raw = e instanceof Error ? e.message : String(e);
      const timedOut =
        (e instanceof Error && e.name === "TimeoutError") || /abort|signal is aborted/i.test(raw);
      setState({ status: "error", message: timedOut ? TIMEOUT_MESSAGE : raw });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
