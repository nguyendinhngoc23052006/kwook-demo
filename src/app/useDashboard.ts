import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import type { ListingRow } from "./group.js";

export type Sweep = {
  id: string;
  started_at: string;
  finished_at: string | null;
  sources_ok: number;
  sources_attempted: number;
  listings_observed: number;
  errors: unknown;
};

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

export type Dashboard = {
  sweep: Sweep | null;
  listings: ListingRow[];
  products: Product[];
  events: EventRow[];
  sources: Source[];
};

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
  listing_urls: { url: string; product_sku: string | null; source_id: string } | null;
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
        .limit(1)
        .maybeSingle();
      if (sweepRes.error) throw new Error(sweepRes.error.message);

      const sweep = sweepRes.data as Sweep | null;

      // Products and sources describe the setup, so they load even with no sweep
      // yet — that empty state should still show what is being watched.
      const [productsRes, sourcesRes] = await Promise.all([
        supabase.from("products").select("sku,name_canonical,reference_price_vnd"),
        supabase
          .from("sources")
          .select("id,display_name,domain,active,consecutive_failures,last_success_at")
          .order("id"),
      ]);
      if (productsRes.error) throw new Error(productsRes.error.message);
      if (sourcesRes.error) throw new Error(sourcesRes.error.message);

      let listings: ListingRow[] = [];
      let events: EventRow[] = [];

      if (sweep) {
        const [obsRes, eventsRes] = await Promise.all([
          supabase
            .from("observations")
            .select(
              "listing_url_id,title_seen,price_vnd,original_price_vnd,units_sold,review_count,listing_urls(url,product_sku,source_id)",
            )
            .eq("sweep_id", sweep.id),
          supabase
            .from("events")
            .select("id,type,severity,product_sku,listing_url_id,old_value,new_value")
            .eq("sweep_id", sweep.id),
        ]);
        if (obsRes.error) throw new Error(obsRes.error.message);
        if (eventsRes.error) throw new Error(eventsRes.error.message);

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
        }));
        events = eventsRes.data as EventRow[];
      }

      if (!cancelled) {
        setState({
          status: "ready",
          data: {
            sweep,
            listings,
            products: productsRes.data as Product[],
            events,
            sources: sourcesRes.data as Source[],
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
