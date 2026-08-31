import { afterEach, describe, expect, it } from "vitest";
import { byVersionDesc, decide, replacementFrom } from "./gemini.js";
import { proposeResolutions } from "./propose.js";

const saved = process.env.GEMINI_API_KEY;
afterEach(() => {
  if (saved === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = saved;
});

const catalogue = [
  {
    sku: "KW-VUN-300",
    name: "Rong biển vụn trộn cơm gói to 300g",
    netWeightG: 300,
    packFormat: "goi",
  },
];

describe("proposeResolutions", () => {
  it("returns nothing when no key is configured, rather than throwing", async () => {
    delete process.env.GEMINI_API_KEY;
    // The sweep must behave exactly as it did before the model existed: no
    // credentials is a normal state, not a failure. A throw here would take
    // down a sweep whose real product - the observations - needs no model.
    await expect(proposeResolutions(["Rong biển vụn 300g"], catalogue)).resolves.toEqual({
      proposals: [],
      model: "",
    });
  });

  it("does not call out at all when there is nothing unresolved", async () => {
    // Guards the cost path: an empty queue must not produce a request even
    // when a key IS present.
    process.env.GEMINI_API_KEY = "not-used-because-titles-is-empty";
    await expect(proposeResolutions([], catalogue)).resolves.toEqual({ proposals: [], model: "" });
  });
});

describe("byVersionDesc", () => {
  it("picks the newest, which a string sort got wrong in production", () => {
    // The real failure: ascending string order chose gemini-2.5-flash, which
    // ListModels advertises but the API refuses for new keys.
    const models = ["gemini-2.5-flash", "gemini-3.6-flash", "gemini-3.0-flash"];
    expect([...models].sort(byVersionDesc)[0]).toBe("gemini-3.6-flash");
  });

  it("compares versions numerically, so 10 beats 2", () => {
    expect([...["gemini-2.5-flash", "gemini-10.0-flash"]].sort(byVersionDesc)[0]).toBe(
      "gemini-10.0-flash",
    );
  });

  it("orders by minor version when majors tie", () => {
    expect([...["gemini-3.1-flash", "gemini-3.12-flash"]].sort(byVersionDesc)[0]).toBe(
      "gemini-3.12-flash",
    );
  });
});

describe("replacementFrom", () => {
  it("reads the successor out of Gemini's retirement message", () => {
    // Verbatim from the sweep that failed.
    const body =
      '{"error":{"code":404,"message":"This model models/gemini-2.5-flash is no longer available to new users. Please update your code to use models/gemini-3.6-flash for the latest features and improvements.","status":"NOT_FOUND"}}';
    expect(replacementFrom(body)).toBe("gemini-3.6-flash");
  });

  it("returns null when the error names no successor, so the sweep reports it", () => {
    expect(replacementFrom('{"error":{"code":404,"message":"not found"}}')).toBeNull();
  });
});

describe("decide", () => {
  it("treats 503 as retryable, which is what actually happened", () => {
    // Verbatim cause of the second failed sweep: the newest model is also the
    // busiest. "High demand" is not a reason to lose an hour of proposals.
    expect(decide(503)).toBe("retry");
  });

  it("treats 429 as retryable too", () => {
    expect(decide(429)).toBe("retry");
  });

  it("moves to the next candidate on a 404, rather than retrying a retired model", () => {
    expect(decide(404)).toBe("next");
  });

  it("does not retry a bad request, which would fail identically forever", () => {
    expect(decide(400)).toBe("next");
  });

  it("accepts any 2xx", () => {
    expect(decide(200)).toBe("ok");
  });
});
