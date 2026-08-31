/**
 * Pure grouping for the Bảng giá screen. No I/O, no Supabase types — arrays in,
 * rows out — so the ranking rule is testable without a database.
 */

export type ListingRow = {
  listing_url_id: string;
  url: string;
  product_sku: string | null;
  source_id: string;
  title_seen: string | null;
  price_vnd: number | null;
  original_price_vnd: number | null;
  units_sold: number | null;
  review_count: number | null;
};

export type SkuGroup = {
  sku: string;
  name: string;
  referencePriceVnd: number | null;
  listings: ListingRow[];
  minVnd: number | null;
  maxVnd: number | null;
  /** null when fewer than two listings carry a price — dispersion isn't computable. */
  spreadPct: number | null;
};

export function groupBySku(
  listings: ListingRow[],
  products: { sku: string; name_canonical: string; reference_price_vnd: number | null }[],
): SkuGroup[] {
  const byName = new Map(products.map((p) => [p.sku, p]));
  const buckets = new Map<string, ListingRow[]>();

  for (const l of listings) {
    if (l.product_sku === null) continue; // the Chưa khớp screen owns these
    const bucket = buckets.get(l.product_sku);
    if (bucket) bucket.push(l);
    else buckets.set(l.product_sku, [l]);
  }

  const groups: SkuGroup[] = [];
  for (const [sku, rows] of buckets) {
    const priced = rows
      .map((r) => r.price_vnd)
      .filter((p): p is number => typeof p === "number" && p > 0);
    const min = priced.length > 0 ? Math.min(...priced) : null;
    const max = priced.length > 0 ? Math.max(...priced) : null;

    groups.push({
      sku,
      name: byName.get(sku)?.name_canonical ?? sku,
      referencePriceVnd: byName.get(sku)?.reference_price_vnd ?? null,
      // Priced listings first, cheapest to dearest; unpriced sink to the bottom.
      listings: [...rows].sort(
        (a, b) =>
          (a.price_vnd ?? Number.MAX_SAFE_INTEGER) - (b.price_vnd ?? Number.MAX_SAFE_INTEGER),
      ),
      minVnd: min,
      maxVnd: max,
      spreadPct:
        priced.length >= 2 && min !== null && max !== null && min > 0
          ? ((max - min) / min) * 100
          : null,
    });
  }

  // Worst spread first; a SKU whose spread isn't computable ranks last, not zero.
  return groups.sort((a, b) => (b.spreadPct ?? -1) - (a.spreadPct ?? -1));
}
