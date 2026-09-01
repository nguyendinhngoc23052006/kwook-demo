import { describe, expect, it } from "vitest";
import {
  attributionLoss,
  deadListing,
  dispersion,
  fakeAnchor,
  floorBreach,
  newSeller,
  type Observation,
  selfCannibalization,
} from "./detect.js";

const at = (h: number) => new Date(Date.UTC(2026, 7, 30, h)).toISOString();

const obs = (o: Partial<Observation> & { listingUrlId: string }): Observation => ({
  sellerId: "kitbuy",
  productSku: "KW-CUON-100LA-250",
  title: "Rong biển cuộn cơm 100 lá",
  priceVnd: null,
  originalPriceVnd: null,
  unitsSold: null,
  brandString: "Kwook",
  observedAt: at(12),
  ...o,
});

// The real 100-lá cluster from the 2026-08-30 sweep: one seller, one product.
const cluster = [
  obs({ listingUrlId: "a", priceVnd: 120_000, unitsSold: 190 }),
  obs({ listingUrlId: "b", priceVnd: 185_000, unitsSold: 910 }),
  obs({ listingUrlId: "c", priceVnd: 185_000, unitsSold: 122 }),
  obs({ listingUrlId: "d", priceVnd: 210_000, unitsSold: 256 }),
  obs({ listingUrlId: "e", priceVnd: 290_000, unitsSold: null }),
];

describe("selfCannibalization", () => {
  it("fires on the real cluster and reports the true spread", () => {
    const [f] = selfCannibalization(cluster);
    expect(f.type).toBe("self_cannibalization");
    expect(f.severity).toBe("high");
    expect(f.newValue).toBe("120.000 – 290.000 đ (+141.7%)");
  });

  it("stays silent when one seller has a single listing per SKU", () => {
    expect(selfCannibalization([cluster[0]])).toEqual([]);
  });

  it("stays silent when listings of a SKU belong to different sellers", () => {
    const split = [cluster[0], { ...cluster[4], sellerId: "abby" }];
    expect(selfCannibalization(split)).toEqual([]);
  });

  it("ignores unpriced listings and empty input", () => {
    expect(selfCannibalization([])).toEqual([]);
    expect(selfCannibalization([obs({ listingUrlId: "x" }), obs({ listingUrlId: "y" })])).toEqual(
      [],
    );
  });
});

describe("deadListing", () => {
  const series = [
    obs({ listingUrlId: "a", unitsSold: 190, observedAt: at(1) }),
    obs({ listingUrlId: "a", unitsSold: 205, observedAt: at(20) }),
    obs({ listingUrlId: "e", unitsSold: 12, observedAt: at(1) }),
    obs({ listingUrlId: "e", unitsSold: 12, observedAt: at(20) }),
  ];

  // The clock these observations were taken against, pinned an hour after the
  // last of them. Without this the suite quietly depends on the real date:
  // the fixture sits on 2026-08-30 and the window is 48 hours, so every one
  // of these assertions started failing at 2026-09-01T01:00Z regardless of
  // what the branch had changed.
  const NOW = Date.UTC(2026, 7, 30, 21);

  it("flags the flat listing while a sibling sells", () => {
    const f = deadListing(series, 48, NOW);
    expect(f).toHaveLength(1);
    expect(f[0].listingUrlId).toBe("e");
  });

  it("stays silent when nothing is selling - a quiet SKU is not a dead listing", () => {
    const quiet = series.map((o) => ({ ...o, unitsSold: 5 }));
    expect(deadListing(quiet, 48, NOW)).toEqual([]);
  });

  it("needs two points inside the window, so a single sweep flags nothing", () => {
    expect(
      deadListing(
        series.filter((o) => o.observedAt === at(1)),
        48,
        NOW,
      ),
    ).toEqual([]);
  });

  it("ignores observations older than the window, however many there are", () => {
    // The behaviour the rotted test was accidentally exercising: once the
    // fixture falls out of the window there are fewer than two points per
    // listing, so nothing is flagged. Asserted deliberately now, with an
    // explicit clock, instead of arriving two days late by surprise.
    const later = Date.UTC(2026, 7, 30, 21) + 72 * 3_600_000;
    expect(deadListing(series, 48, later)).toEqual([]);
  });
});

describe("dispersion", () => {
  it("needs more than one seller to be computable", () => {
    expect(dispersion(cluster)).toEqual([]);
  });

  it("fires across sellers and grades by magnitude", () => {
    const [f] = dispersion([cluster[0], { ...cluster[4], sellerId: "abby" }]);
    expect(f.severity).toBe("high");
    expect(f.oldValue).toBe("2 người bán");
  });
});

describe("floorBreach", () => {
  const ref = new Map([["KW-CUON-100LA-250", 185_000]]);

  it("fires below reference minus tolerance", () => {
    const [f] = floorBreach([cluster[0]], ref);
    expect(f.severity).toBe("high");
    expect(f.newValue).toContain("120.000");
  });

  it("is silent at reference and silent with no reference price", () => {
    expect(floorBreach([cluster[1]], ref)).toEqual([]);
    expect(floorBreach([cluster[0]], new Map())).toEqual([]);
  });
});

describe("fakeAnchor", () => {
  it("fires on the real 400g listing", () => {
    const [f] = fakeAnchor([
      obs({ listingUrlId: "f", priceVnd: 159_000, originalPriceVnd: 1_250_000 }),
    ]);
    expect(f.newValue).toBe("gấp 7.9 lần giá bán");
  });

  it("ignores an ordinary discount and a missing anchor", () => {
    expect(
      fakeAnchor([obs({ listingUrlId: "g", priceVnd: 120_000, originalPriceVnd: 200_000 })]),
    ).toEqual([]);
    expect(fakeAnchor([cluster[0]])).toEqual([]);
  });

  it("ignores an anchor BELOW the price - that is a display bug, not a fake anchor", () => {
    expect(
      fakeAnchor([obs({ listingUrlId: "h", priceVnd: 210_000, originalPriceVnd: 200_000 })]),
    ).toEqual([]);
  });
});

describe("attributionLoss", () => {
  it("fires on empty, No Brand, and unrecognised spellings", () => {
    const bad = [
      obs({ listingUrlId: "i", brandString: null }),
      obs({ listingUrlId: "j", brandString: "No Brand" }),
      obs({ listingUrlId: "k", brandString: "KWok" }),
    ];
    expect(attributionLoss(bad, ["Kwook", "K-WOOK"])).toHaveLength(3);
  });

  it("accepts known spellings regardless of case", () => {
    expect(
      attributionLoss([obs({ listingUrlId: "l", brandString: "k-wook" })], ["Kwook", "K-WOOK"]),
    ).toEqual([]);
  });
});

describe("newSeller", () => {
  it("reports only listings absent from the previous sweep", () => {
    const f = newSeller(cluster, [cluster[0], cluster[1]]);
    expect(f.map((x) => x.listingUrlId)).toEqual(["c", "d", "e"]);
    expect(f[0].severity).toBe("info");
  });

  it("reports everything on the very first sweep", () => {
    expect(newSeller(cluster, [])).toHaveLength(5);
  });
});
