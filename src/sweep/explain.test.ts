import { afterEach, describe, expect, it } from "vitest";
import { describe as describeFinding, explainFindings } from "./explain.js";

const saved = process.env.GEMINI_API_KEY;
afterEach(() => {
  if (saved === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = saved;
});

const finding = {
  id: "11111111-1111-1111-1111-111111111111",
  type: "dispersion",
  severity: "high",
  subject: "KW-VUN-400 — Rong biển vụn 400g",
  seller: "tiki",
  oldValue: "135.000 đ",
  newValue: "169.000 đ",
};

describe("explainFindings", () => {
  it("leaves alerts alone when no key is configured, rather than throwing", async () => {
    delete process.env.GEMINI_API_KEY;
    // Findings are the product; the wording is an assist. A sweep with no
    // credentials must still write its events and fall back to the static
    // per-type sentence the dashboard has always had.
    const out = await explainFindings([finding]);
    expect(out.model).toBe("");
    expect(out.explanations.size).toBe(0);
  });

  it("does not call out at all when there are no findings", async () => {
    process.env.GEMINI_API_KEY = "not-used-because-findings-is-empty";
    const out = await explainFindings([]);
    expect(out.explanations.size).toBe(0);
  });
});

describe("describe", () => {
  it("hands the model the numbers already formatted, never raw", () => {
    // The model must never render a price itself: a model restating a number
    // is a model that can restate it wrong.
    const line = describeFinding(finding);
    expect(line).toContain("135.000 đ → 169.000 đ");
    expect(line).toContain("id: 11111111-1111-1111-1111-111111111111");
  });

  it("explains what the detector measures, so the model is not guessing from a name", () => {
    expect(describeFinding(finding)).toContain("khoảng giá rộng");
  });

  it("omits the seller line when a finding is scoped to a SKU, not a listing", () => {
    expect(describeFinding({ ...finding, seller: null })).not.toContain("người bán:");
  });

  it("still describes a finding that carries no numbers", () => {
    const line = describeFinding({ ...finding, oldValue: null, newValue: null });
    expect(line).not.toContain("số liệu:");
    expect(line).toContain("mức độ: high");
  });
});
