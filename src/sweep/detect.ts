/**
 * Seven detectors. Pure functions over observation arrays: no fetch, no model,
 * no database. That is what makes them testable and what keeps a sweep cheap.
 */

import { formatVnd } from "../lib/vnd.js";

export type Observation = {
  listingUrlId: string;
  sellerId: string;
  productSku: string | null;
  title: string;
  priceVnd: number | null;
  originalPriceVnd: number | null;
  unitsSold: number | null;
  brandString: string | null;
  observedAt: string;
};

export type Finding = {
  type: string;
  severity: "info" | "medium" | "high";
  productSku: string | null;
  listingUrlId: string | null;
  oldValue: string | null;
  newValue: string | null;
};

const priced = (o: Observation): o is Observation & { priceVnd: number } => o.priceVnd !== null;

function bySku(obs: Observation[]): Map<string, Observation[]> {
  const m = new Map<string, Observation[]>();
  for (const o of obs) {
    if (!o.productSku) continue;
    const list = m.get(o.productSku) ?? [];
    list.push(o);
    m.set(o.productSku, list);
  }
  return m;
}

/** 2+ listings for one SKU from the SAME seller, price gap over threshold. */
export function selfCannibalization(obs: Observation[], gapPct = 25): Finding[] {
  const out: Finding[] = [];
  for (const [sku, group] of bySku(obs.filter(priced))) {
    const bySeller = new Map<string, (Observation & { priceVnd: number })[]>();
    for (const o of group as (Observation & { priceVnd: number })[]) {
      bySeller.set(o.sellerId, [...(bySeller.get(o.sellerId) ?? []), o]);
    }
    for (const [seller, list] of bySeller) {
      if (list.length < 2) continue;
      const prices = list.map((o) => o.priceVnd);
      const min = Math.min(...prices);
      const max = Math.max(...prices);
      const gap = ((max - min) / min) * 100;
      if (gap > gapPct) {
        out.push({
          type: "self_cannibalization",
          severity: "high",
          productSku: sku,
          listingUrlId: null,
          oldValue: `${seller}: ${list.length} listing`,
          newValue: `${formatVnd(min)} – ${formatVnd(max)} đ (+${gap.toFixed(1)}%)`,
        });
      }
    }
  }
  return out;
}

/**
 * A listing with no units-sold growth over the window while a sibling listing
 * of the same SKU is selling. Window is TIME, not sweep count - at hourly
 * cadence "no growth in 3 sweeps" means three hours and marks everything dead.
 */
export function deadListing(obs: Observation[], windowHours = 24, now = Date.now()): Finding[] {
  const out: Finding[] = [];
  // `now` is injectable because this is the only detector that reads the
  // clock, and a function that reads the clock cannot be pinned by a test.
  // It was not, and the test rotted exactly the way that guarantees: its
  // fixture is dated 2026-08-30 and the window is 48 hours, so the suite
  // passed for two days and then went red on every branch at once from
  // 2026-09-01T01:00Z - on a change that touched nothing near it.
  const cutoff = now - windowHours * 3_600_000;
  for (const [sku, group] of bySku(obs)) {
    const byListing = new Map<string, Observation[]>();
    for (const o of group)
      byListing.set(o.listingUrlId, [...(byListing.get(o.listingUrlId) ?? []), o]);

    const growth = new Map<string, number>();
    for (const [id, series] of byListing) {
      const inWindow = series
        .filter((o) => new Date(o.observedAt).getTime() >= cutoff && o.unitsSold !== null)
        .sort((a, b) => a.observedAt.localeCompare(b.observedAt));
      if (inWindow.length < 2) continue;
      growth.set(id, (inWindow.at(-1)?.unitsSold ?? 0) - (inWindow[0]?.unitsSold ?? 0));
    }
    if (growth.size < 2) continue;
    const anySelling = [...growth.values()].some((g) => g > 0);
    if (!anySelling) continue;
    for (const [id, g] of growth) {
      if (g === 0) {
        out.push({
          type: "dead_listing",
          severity: "medium",
          productSku: sku,
          listingUrlId: id,
          oldValue: `0 lượt bán trong ${windowHours} giờ`,
          newValue: "listing cùng sản phẩm vẫn đang bán",
        });
      }
    }
  }
  return out;
}

/** Spread across DIFFERENT sellers. Not computable with a single seller. */
export function dispersion(obs: Observation[], thresholdPct = 30): Finding[] {
  const out: Finding[] = [];
  for (const [sku, group] of bySku(obs.filter(priced))) {
    const sellers = new Set(group.map((o) => o.sellerId));
    if (sellers.size < 2) continue;
    const prices = (group as (Observation & { priceVnd: number })[]).map((o) => o.priceVnd);
    const min = Math.min(...prices);
    const spread = ((Math.max(...prices) - min) / min) * 100;
    if (spread > thresholdPct) {
      out.push({
        type: "dispersion",
        severity: spread > 100 ? "high" : "medium",
        productSku: sku,
        listingUrlId: null,
        oldValue: `${sellers.size} người bán`,
        newValue: `+${spread.toFixed(1)}%`,
      });
    }
  }
  return out;
}

/** Selling below the reference shelf price, allowing a tolerance. */
export function floorBreach(
  obs: Observation[],
  referenceBySku: Map<string, number>,
  tolerance = 0.1,
): Finding[] {
  return obs.filter(priced).flatMap((o) => {
    const ref = o.productSku ? referenceBySku.get(o.productSku) : undefined;
    if (ref === undefined) return [];
    const floor = ref * (1 - tolerance);
    if (o.priceVnd >= floor) return [];
    return [
      {
        type: "floor_breach",
        severity: "high" as const,
        productSku: o.productSku,
        listingUrlId: o.listingUrlId,
        oldValue: `sàn ${formatVnd(ref)} đ`,
        newValue: `${formatVnd(o.priceVnd)} đ (${(((o.priceVnd - ref) / ref) * 100).toFixed(1)}%)`,
      },
    ];
  });
}

/** A strikethrough "original" price wildly above what the thing sells for. */
export function fakeAnchor(obs: Observation[], multiple = 3): Finding[] {
  return obs.filter(priced).flatMap((o) => {
    if (o.originalPriceVnd === null) return [];
    if (o.originalPriceVnd <= o.priceVnd * multiple) return [];
    return [
      {
        type: "fake_anchor",
        severity: "medium" as const,
        productSku: o.productSku,
        listingUrlId: o.listingUrlId,
        oldValue: `giá gạch ${formatVnd(o.originalPriceVnd)} đ`,
        newValue: `gấp ${(o.originalPriceVnd / o.priceVnd).toFixed(1)} lần giá bán`,
      },
    ];
  });
}

/** Brand field empty, "No Brand", or not one of the accepted spellings. */
export function attributionLoss(obs: Observation[], accepted: string[]): Finding[] {
  const ok = new Set(accepted.map((a) => a.toLowerCase()));
  return obs.flatMap((o) => {
    const b = o.brandString?.trim().toLowerCase() ?? "";
    if (b !== "" && b !== "no brand" && ok.has(b)) return [];
    return [
      {
        type: "attribution_loss",
        severity: "high" as const,
        productSku: o.productSku,
        listingUrlId: o.listingUrlId,
        oldValue: o.brandString ?? "(trống)",
        newValue: "không khớp cách viết thương hiệu nào",
      },
    ];
  });
}

/** A listing id never seen in the previous sweep. */
export function newSeller(current: Observation[], previous: Observation[]): Finding[] {
  const seen = new Set(previous.map((o) => o.listingUrlId));
  return current
    .filter((o) => !seen.has(o.listingUrlId))
    .map((o) => ({
      type: "new_seller" as const,
      severity: "info" as const,
      productSku: o.productSku,
      listingUrlId: o.listingUrlId,
      oldValue: null,
      newValue: o.title,
    }));
}
