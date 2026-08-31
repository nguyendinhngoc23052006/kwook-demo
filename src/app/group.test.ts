import { describe, expect, it } from "vitest";
import { groupBySku, type ListingRow } from "./group.js";

function listing(over: Partial<ListingRow>): ListingRow {
  return {
    listing_url_id: "x",
    url: "https://example.test/x",
    product_sku: "SKU-A",
    source_id: "kitbuy",
    title_seen: "t",
    price_vnd: 100_000,
    original_price_vnd: null,
    units_sold: null,
    review_count: null,
    ...over,
  };
}

const products = [
  { sku: "SKU-A", name_canonical: "A", reference_price_vnd: 150_000 },
  { sku: "SKU-B", name_canonical: "B", reference_price_vnd: null },
];

describe("groupBySku", () => {
  it("drops unresolved listings — the Chưa khớp screen owns them", () => {
    const groups = groupBySku([listing({ product_sku: null })], products);
    expect(groups).toEqual([]);
  });

  it("leaves spread null for a single listing rather than reporting 0%", () => {
    const groups = groupBySku([listing({})], products);
    expect(groups[0]?.spreadPct).toBeNull();
    expect(groups[0]?.minVnd).toBe(100_000);
  });

  it("computes spread against the cheapest listing", () => {
    const groups = groupBySku(
      [listing({ price_vnd: 120_000 }), listing({ price_vnd: 290_000 })],
      products,
    );
    expect(groups[0]?.spreadPct).toBeCloseTo(141.67, 1);
  });

  it("ranks the worst spread first and sinks the incomputable one", () => {
    const groups = groupBySku(
      [
        listing({ product_sku: "SKU-B", price_vnd: 50_000 }),
        listing({ price_vnd: 100_000 }),
        listing({ price_vnd: 300_000 }),
      ],
      products,
    );
    expect(groups.map((g) => g.sku)).toEqual(["SKU-A", "SKU-B"]);
  });

  it("ignores unpriced listings when computing the range but keeps them listed", () => {
    const groups = groupBySku(
      [listing({ price_vnd: 100_000 }), listing({ price_vnd: null })],
      products,
    );
    expect(groups[0]?.spreadPct).toBeNull();
    expect(groups[0]?.listings).toHaveLength(2);
    expect(groups[0]?.listings[1]?.price_vnd).toBeNull();
  });

  it("falls back to the sku when no product row names it", () => {
    const groups = groupBySku([listing({ product_sku: "SKU-Z" })], products);
    expect(groups[0]?.name).toBe("SKU-Z");
  });
});
