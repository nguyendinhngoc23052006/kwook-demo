import { describe, expect, it } from "vitest";
import { stillListed } from "./current.js";

const START = "2026-08-31T13:55:00.000Z";
const DURING = "2026-08-31T13:57:46.000Z";
const YESTERDAY = "2026-08-30T19:29:10.000Z";

describe("stillListed", () => {
  it("keeps a listing seen during this sweep", () => {
    const rows = [{ source_id: "kitbuy", last_seen_at: DURING }];
    expect(stillListed(rows, new Set(["kitbuy"]), START)).toHaveLength(1);
  });

  it("drops a listing its source no longer returns", () => {
    // The real case: a Shopee shop header captured by an earlier parser,
    // last observed 19 hours before the sweep that read kitbuy cleanly.
    const rows = [{ source_id: "kitbuy", last_seen_at: YESTERDAY }];
    expect(stillListed(rows, new Set(["kitbuy"]), START)).toHaveLength(0);
  });

  it("keeps everything from a source that failed this sweep", () => {
    // kwookvn answers scrapers with a challenge page. Its listings are not
    // gone - we simply could not look, and guessing they are gone would erase
    // the brand's own site from the queue.
    const rows = [{ source_id: "kwookvn", last_seen_at: YESTERDAY }];
    expect(stillListed(rows, new Set(["kitbuy"]), START)).toHaveLength(1);
  });

  it("drops a listing with no last_seen_at from a source that was read", () => {
    const rows = [{ source_id: "kitbuy", last_seen_at: null }];
    expect(stillListed(rows, new Set(["kitbuy"]), START)).toHaveLength(0);
  });

  it("keeps a listing seen exactly at the sweep's start instant", () => {
    const rows = [{ source_id: "kitbuy", last_seen_at: START }];
    expect(stillListed(rows, new Set(["kitbuy"]), START)).toHaveLength(1);
  });
});
