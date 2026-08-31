import { describe, expect, it } from "vitest";
import { changesBetween, type Snapshot } from "./history.js";

function snap(over: Partial<Snapshot>): Snapshot {
  return {
    listing_url_id: "L1",
    sweep_id: "S1",
    observed_at: "2026-08-30T19:00:00Z",
    title_seen: "Rong biển",
    price_vnd: 120_000,
    units_sold: 10,
    ...over,
  };
}

describe("changesBetween", () => {
  it("reports nothing for a single sighting", () => {
    expect(changesBetween([snap({})])).toEqual([]);
  });

  it("reports nothing when a listing holds steady", () => {
    expect(
      changesBetween([
        snap({ observed_at: "2026-08-30T19:00:00Z" }),
        snap({ observed_at: "2026-08-30T20:00:00Z" }),
      ]),
    ).toEqual([]);
  });

  it("reports a price move", () => {
    const out = changesBetween([
      snap({ observed_at: "2026-08-30T19:00:00Z", price_vnd: 120_000 }),
      snap({ observed_at: "2026-08-30T20:00:00Z", price_vnd: 99_000 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ field: "price", from: 120_000, to: 99_000 });
  });

  it("reports a price becoming unreadable, so a parser regression surfaces", () => {
    const out = changesBetween([
      snap({ observed_at: "2026-08-30T19:00:00Z", price_vnd: 120_000 }),
      snap({ observed_at: "2026-08-30T20:00:00Z", price_vnd: null }),
    ]);
    expect(out[0]).toMatchObject({ field: "price", from: 120_000, to: null });
  });

  it("counts units growth as a sale but ignores a counter reset", () => {
    const grew = changesBetween([
      snap({ observed_at: "2026-08-30T19:00:00Z", units_sold: 10 }),
      snap({ observed_at: "2026-08-30T20:00:00Z", units_sold: 14 }),
    ]);
    expect(grew).toHaveLength(1);
    expect(grew[0]).toMatchObject({ field: "units_sold", from: 10, to: 14 });

    const dropped = changesBetween([
      snap({ observed_at: "2026-08-30T19:00:00Z", units_sold: 14 }),
      snap({ observed_at: "2026-08-30T20:00:00Z", units_sold: 10 }),
    ]);
    expect(dropped).toEqual([]);
  });

  it("keeps listings separate and returns newest first", () => {
    const out = changesBetween([
      snap({ listing_url_id: "L1", observed_at: "2026-08-30T19:00:00Z", price_vnd: 100 }),
      snap({ listing_url_id: "L1", observed_at: "2026-08-30T20:00:00Z", price_vnd: 200 }),
      snap({ listing_url_id: "L2", observed_at: "2026-08-30T21:00:00Z", price_vnd: 300 }),
      snap({ listing_url_id: "L2", observed_at: "2026-08-30T22:00:00Z", price_vnd: 400 }),
    ]);
    expect(out.map((c) => c.observed_at)).toEqual(["2026-08-30T22:00:00Z", "2026-08-30T20:00:00Z"]);
  });
});
