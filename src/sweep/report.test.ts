import { describe, expect, it } from "vitest";
import { buildReport, MAX_MESSAGE_CHARS, type ReportFinding } from "./report.js";

const at = new Date("2026-09-03T07:05:00Z"); // 14:05 in Hồ Chí Minh

const base = {
  startedAt: at,
  sourcesOk: 7,
  sourcesAttempted: 7,
  listings: 42,
  degraded: 0,
  dashboardUrl: "https://kwook-demo.pages.dev",
};

const finding = (o: Partial<ReportFinding> = {}): ReportFinding => ({
  type: "self_cannibalization",
  severity: "high",
  subject: "Rong biển cuộn cơm 100 lá",
  seller: "kitbuy: 5 listing",
  oldValue: null,
  newValue: "120.000 – 290.000 đ (+141.7%)",
  ...o,
});

describe("buildReport", () => {
  it("leads with the numbers a reader checks first", () => {
    const text = buildReport({ ...base, findings: [finding()] });
    expect(text).toContain("7/7 nguồn · 42 listing · 1 cảnh báo (1 nghiêm trọng)");
  });

  it("renders the local time, not UTC", () => {
    // 07:05 UTC is 14:05 in Vietnam. A report stamped 07:05 would look stale
    // by seven hours to the only people who read it.
    expect(buildReport({ ...base, findings: [] })).toContain("14:05");
  });

  it("says so plainly when nothing fired", () => {
    const text = buildReport({ ...base, findings: [] });
    expect(text).toContain("Không có cảnh báo nào giờ này.");
    expect(text).not.toContain("nghiêm trọng");
  });

  it("puts severe findings first, whatever order they arrive in", () => {
    const text = buildReport({
      ...base,
      findings: [
        finding({ severity: "info", subject: "A", type: "new_seller" }),
        finding({ severity: "high", subject: "B" }),
      ],
    });
    expect(text.indexOf("B —")).toBeLessThan(text.indexOf("A —"));
  });

  it("carries the model's sentence when there is one, and no filler when not", () => {
    const withText = buildReport({
      ...base,
      findings: [finding({ explanation: "Người mua sẽ chọn mức thấp nhất." })],
    });
    expect(withText).toContain("Người mua sẽ chọn mức thấp nhất.");

    // Without an explanation the finding is two lines - the headline and the
    // numbers - and nothing stands in for the missing sentence.
    const withNull = buildReport({ ...base, findings: [finding({ explanation: null })] });
    expect(withNull).toContain("Rong biển cuộn cơm 100 lá");
    const indented = withNull.split("\n").filter((l) => l.startsWith("  "));
    expect(indented).toEqual(["  kitbuy: 5 listing · 120.000 – 290.000 đ (+141.7%)"]);
  });

  it("summarises the tail rather than listing every finding", () => {
    const many = Array.from({ length: 11 }, (_, i) => finding({ subject: `SP ${i}` }));
    const text = buildReport({ ...base, findings: many });
    expect(text).toContain("và 7 cảnh báo khác.");
    expect(text).not.toContain("SP 9");
  });

  it("reports degraded sources without calling the sweep failed", () => {
    const text = buildReport({ ...base, degraded: 2, findings: [] });
    expect(text).toContain("2 sự cố đã ghi nhận");
    expect(text).toContain("dữ liệu vẫn được lưu");
  });

  it("stays under Telegram's hard limit and keeps the link when truncating", () => {
    const huge = Array.from({ length: 4 }, () => finding({ explanation: "x".repeat(3000) }));
    const text = buildReport({ ...base, findings: huge });
    expect(text.length).toBeLessThanOrEqual(MAX_MESSAGE_CHARS);
    // The link is the whole point of a truncated report - it must survive.
    expect(text.endsWith("https://kwook-demo.pages.dev")).toBe(true);
    expect(text).toContain("…");
  });

  it("works with no dashboard link configured", () => {
    const text = buildReport({ ...base, dashboardUrl: null, findings: [finding()] });
    expect(text).not.toContain("https://");
    expect(text).toContain("cảnh báo");
  });
});

describe("a broken sweep must not read like a quiet one", () => {
  const base = {
    startedAt: new Date("2026-09-03T11:30:00Z"),
    sourcesOk: 0,
    sourcesAttempted: 0,
    listings: 0,
    findings: [],
    degraded: 1,
  };

  it("leads with the failure instead of reporting calm", () => {
    const msg = buildReport({
      ...base,
      failure: "could not record this sweep's findings (load)",
    });
    expect(msg).toContain("LƯỢT QUÉT HỎNG");
    expect(msg).not.toContain("Không có cảnh báo nào giờ này");
    expect(msg).toContain("không phản ánh thị trường");
  });

  it("never claims the data was kept when the sweep kept none", () => {
    const msg = buildReport({ ...base, failure: "every source failed (0 of 7)" });
    expect(msg).not.toContain("dữ liệu vẫn được lưu");
  });

  it("still reads as a quiet hour when the sweep genuinely worked", () => {
    const msg = buildReport({
      ...base,
      sourcesOk: 7,
      sourcesAttempted: 7,
      listings: 42,
      degraded: 0,
      failure: null,
    });
    expect(msg).toContain("Không có cảnh báo nào giờ này");
    expect(msg).not.toContain("LƯỢT QUÉT HỎNG");
  });
});
