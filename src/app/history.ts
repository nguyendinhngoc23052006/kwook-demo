/**
 * Pure history diffing. Arrays in, changes out — same shape as the detectors,
 * so what counts as a change is testable without a database.
 */

export type Snapshot = {
  listing_url_id: string;
  sweep_id: string;
  observed_at: string;
  title_seen: string | null;
  price_vnd: number | null;
  units_sold: number | null;
  /** Who is selling it. A change nobody can attribute is not actionable. */
  source_id: string;
  product_sku: string | null;
};

export type Change = {
  listing_url_id: string;
  title: string;
  observed_at: string;
  source_id: string;
  product_sku: string | null;
  /**
   * price        - the seller moved the price. The only one that is news.
   * first_price  - we could not read a price before and now can. That is a
   *                fact about OUR parser, not about the seller, and showing
   *                it as "— → 10.800 đ" invites the reader to think a seller
   *                did something.
   * price_lost   - we could read it before and cannot now: a parser or page
   *                regression, worth surfacing loudly.
   * units_sold   - the cumulative counter grew, i.e. units actually sold.
   */
  kind: "price" | "first_price" | "price_lost" | "units_sold";
  from: number | null;
  to: number | null;
};

/**
 * Consecutive observations of the same listing, compared pairwise.
 *
 * A first sighting is not a change — there is nothing to compare it against —
 * and neither is a value going from null to null. But a price that becomes
 * unreadable (a number, then null) IS reported: silently dropping it would
 * hide a parser regression, which is exactly the failure this screen should
 * catch first.
 */
export function changesBetween(snapshots: Snapshot[]): Change[] {
  const byListing = new Map<string, Snapshot[]>();
  for (const s of snapshots) {
    byListing.set(s.listing_url_id, [...(byListing.get(s.listing_url_id) ?? []), s]);
  }

  const out: Change[] = [];
  for (const series of byListing.values()) {
    const ordered = [...series].sort((a, b) => a.observed_at.localeCompare(b.observed_at));
    for (let i = 1; i < ordered.length; i++) {
      const prev = ordered[i - 1];
      const cur = ordered[i];
      if (!prev || !cur) continue;
      const title = cur.title_seen ?? prev.title_seen ?? "(không có tiêu đề)";

      if (prev.price_vnd !== cur.price_vnd) {
        // Separate what the SELLER did from what our parser did. Both matter,
        // but conflating them makes every parser improvement look like a
        // market event.
        const kind =
          prev.price_vnd === null ? "first_price" : cur.price_vnd === null ? "price_lost" : "price";
        out.push({
          listing_url_id: cur.listing_url_id,
          title,
          observed_at: cur.observed_at,
          source_id: cur.source_id,
          product_sku: cur.product_sku,
          kind,
          from: prev.price_vnd,
          to: cur.price_vnd,
        });
      }
      // Shopee's counter is cumulative, so only growth is a real sale. A drop
      // means the seller reset or relisted — noise, not a sale, so skip it.
      if (prev.units_sold !== null && cur.units_sold !== null && cur.units_sold > prev.units_sold) {
        out.push({
          listing_url_id: cur.listing_url_id,
          title,
          observed_at: cur.observed_at,
          source_id: cur.source_id,
          product_sku: cur.product_sku,
          kind: "units_sold",
          from: prev.units_sold,
          to: cur.units_sold,
        });
      }
    }
  }

  return out.sort((a, b) => b.observed_at.localeCompare(a.observed_at));
}
