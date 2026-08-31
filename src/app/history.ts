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
};

export type Change = {
  listing_url_id: string;
  title: string;
  observed_at: string;
  field: "price" | "units_sold";
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
        out.push({
          listing_url_id: cur.listing_url_id,
          title,
          observed_at: cur.observed_at,
          field: "price",
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
          field: "units_sold",
          from: prev.units_sold,
          to: cur.units_sold,
        });
      }
    }
  }

  return out.sort((a, b) => b.observed_at.localeCompare(a.observed_at));
}
