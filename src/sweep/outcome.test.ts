import { describe, expect, it } from "vitest";
import { type SweepError, sweepFailed } from "./outcome.js";

const ok = { sourcesAttempted: 3, sourcesOk: 3 };

describe("sweepFailed", () => {
  it("passes a clean sweep", () => {
    expect(sweepFailed([], ok)).toBeNull();
  });

  // The exact shape that took the chain down on 2026-09-02: everything
  // observed, everything recorded, and the model unavailable at the end.
  it("passes when only the model failed", () => {
    const errors: SweepError[] = [{ stage: "explain", error: "fetch failed" }];
    expect(sweepFailed(errors, ok)).toBeNull();
  });

  it("passes when the resolution proposals failed", () => {
    expect(sweepFailed([{ stage: "propose", error: "HTTP 503" }], ok)).toBeNull();
  });

  it("passes when SOME sources failed - one shop being down is normal", () => {
    const errors: SweepError[] = [
      { source: "abby", url: "https://abby.vn/s/x", error: "HTTP 522" },
      { stage: "explain", error: "fetch failed" },
    ];
    expect(sweepFailed(errors, { sourcesAttempted: 7, sourcesOk: 6 })).toBeNull();
  });

  it("fails when the findings could not be written - that is the output", () => {
    const why = sweepFailed([{ stage: "events", error: "duplicate key" }], ok);
    expect(why).toContain("findings");
  });

  it("fails when every source failed", () => {
    const errors: SweepError[] = [{ source: "abby", error: "HTTP 522" }];
    const why = sweepFailed(errors, { sourcesAttempted: 3, sourcesOk: 0 });
    expect(why).toBe("every source failed (0 of 3)");
  });

  it("does not call an empty database an outage", () => {
    expect(sweepFailed([], { sourcesAttempted: 0, sourcesOk: 0 })).toBeNull();
  });

  it("reports the fatal stage even when degraded errors outnumber it", () => {
    const errors: SweepError[] = [
      { stage: "explain", error: "fetch failed" },
      { source: "tiki", error: "HTTP 403" },
      { stage: "events", error: "connection reset" },
    ];
    expect(sweepFailed(errors, ok)).toContain("events");
  });
});

describe("a sweep that never learned what to watch", () => {
  it("treats a failed configuration read as fatal", () => {
    // Zero attempts is the tell: without this the sweep exits 0, the job goes
    // green, no issue opens, and the hourly report announces no alerts.
    expect(
      sweepFailed([{ stage: "load", error: "sources: JWT expired" }], {
        sourcesAttempted: 0,
        sourcesOk: 0,
      }),
    ).toContain("load");
  });

  it("still lets a model outage through", () => {
    expect(
      sweepFailed([{ stage: "explain", error: "503" }], { sourcesAttempted: 7, sourcesOk: 7 }),
    ).toBeNull();
  });
});
