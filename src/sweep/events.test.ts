import { describe, expect, it } from "vitest";
import type { Observation } from "./detect.js";
import { type Rule, runDetectors } from "./events.js";

const obs = (o: Partial<Observation>): Observation => ({
  listingUrlId: "a",
  sellerId: "s1",
  productSku: "KW-1",
  title: "Rong biển K-WOOK",
  priceVnd: 100000,
  originalPriceVnd: null,
  unitsSold: null,
  brandString: null,
  observedAt: "2026-09-03T11:00:00Z",
  ...o,
});

const rule = (r: Partial<Rule> & { type: string }): Rule => ({
  threshold: {},
  severity: "medium",
  active: true,
  ...r,
});

// Two same-seller listings 100% apart: over any sane gap_pct, under none.
const cannibal = [
  obs({ listingUrlId: "a", priceVnd: 100000 }),
  obs({ listingUrlId: "b", priceVnd: 200000 }),
];

describe("the rules table actually drives the detectors", () => {
  it("does not run a detector whose rule is inactive", () => {
    const found = runDetectors(cannibal, [], new Map(), [
      rule({ type: "self_cannibalization", active: false }),
    ]);
    expect(found).toEqual([]);
  });

  it("does not run a detector with no rule row at all", () => {
    expect(runDetectors(cannibal, [], new Map(), [])).toEqual([]);
  });

  it("uses the threshold from the row, not the hardcoded default", () => {
    // The gap is 100%. A rule of 25 fires; a rule of 150 must not — and
    // before this existed, both produced the same answer.
    const loose = runDetectors(cannibal, [], new Map(), [
      rule({ type: "self_cannibalization", threshold: { gap_pct: 150 } }),
    ]);
    const tight = runDetectors(cannibal, [], new Map(), [
      rule({ type: "self_cannibalization", threshold: { gap_pct: 25 } }),
    ]);
    expect(loose).toEqual([]);
    expect(tight).toHaveLength(1);
  });

  it("falls back to the detector's default when the row omits the key", () => {
    const found = runDetectors(cannibal, [], new Map(), [
      rule({ type: "self_cannibalization", threshold: {} }),
    ]);
    expect(found).toHaveLength(1);
  });

  it("ignores a threshold value of the wrong type rather than producing NaN", () => {
    const found = runDetectors(cannibal, [], new Map(), [
      rule({ type: "self_cannibalization", threshold: { gap_pct: "twenty-five" } }),
    ]);
    expect(found).toHaveLength(1);
  });

  it("raises a finding to the rule's severity", () => {
    // fake_anchor judges every hit "medium"; the rule says these matter more.
    const anchored = [obs({ priceVnd: 100000, originalPriceVnd: 500000 })];
    const [f] = runDetectors(anchored, [], new Map(), [
      rule({ type: "fake_anchor", severity: "high", threshold: { multiple: 3 } }),
    ]);
    expect(f?.severity).toBe("high");
  });

  it("will not let a rule silence a detector's own judgment", () => {
    // Downgrading is deliberately not a lever: the threshold is. A rule that
    // says "info" on a 100% same-seller gap is a mistake, and quietly
    // relabelling a real finding is worse than ignoring the request.
    const [f] = runDetectors(cannibal, [], new Map(), [
      rule({ type: "self_cannibalization", severity: "info" }),
    ]);
    expect(f?.severity).toBe("high");
  });

  it("lets a detector escalate above its rule but never below", () => {
    // dispersion calls a spread over 100% "high" on its own judgment; a rule
    // of "medium" must not silently discard that.
    const wide = [
      obs({ listingUrlId: "a", sellerId: "s1", priceVnd: 100000 }),
      obs({ listingUrlId: "b", sellerId: "s2", priceVnd: 300000 }),
    ];
    const [f] = runDetectors(wide, [], new Map(), [
      rule({ type: "dispersion", severity: "medium", threshold: { pct: 30 } }),
    ]);
    expect(f?.severity).toBe("high");
  });
});

describe("attribution_loss only judges listings that carry a brand", () => {
  const accepted = { accepted: ["Kwook", "K-Wook"] };

  it("ignores a listing whose source publishes no brand field", () => {
    // kitbuy's cards have none. Absence of the field is not a lost brand,
    // and flagging all of them hourly is why this detector was switched off.
    const found = runDetectors([obs({ brandString: null })], [], new Map(), [
      rule({ type: "attribution_loss", severity: "high", threshold: accepted }),
    ]);
    expect(found).toEqual([]);
  });

  it("passes on the spellings the rule accepts", () => {
    const found = runDetectors(
      [obs({ listingUrlId: "t", brandString: "K-Wook" }), obs({ brandString: "Kwook" })],
      [],
      new Map(),
      [rule({ type: "attribution_loss", severity: "high", threshold: accepted })],
    );
    expect(found).toEqual([]);
  });

  it("fires on a brand it does not recognise", () => {
    const found = runDetectors([obs({ brandString: "KWok" })], [], new Map(), [
      rule({ type: "attribution_loss", severity: "high", threshold: accepted }),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe("high");
  });
});

describe("a detector that cannot tell pass from fail does not run", () => {
  it("stays silent when the rule lists no accepted spellings", () => {
    // Reachable between a code deploy and its migration: the row still holds
    // `{}`, and without this guard every brand-bearing listing is a finding.
    const branded = [
      obs({ listingUrlId: "a", brandString: "K-Wook" }),
      obs({ listingUrlId: "b", brandString: "Kwook" }),
    ];
    const found = runDetectors(branded, [], new Map(), [
      rule({ type: "attribution_loss", severity: "high", threshold: {} }),
    ]);
    expect(found).toEqual([]);
  });

  it("ignores an accepted list of the wrong shape", () => {
    const found = runDetectors([obs({ brandString: "K-Wook" })], [], new Map(), [
      rule({ type: "attribution_loss", severity: "high", threshold: { accepted: "Kwook" } }),
    ]);
    expect(found).toEqual([]);
  });
});
