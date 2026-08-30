import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseStoreIndex } from "./parse.js";

const html = readFileSync("fixtures/kitbuy-store-index.html", "utf8");
const listings = parseStoreIndex(html);

describe("parseStoreIndex", () => {
  it("finds every product card", () => {
    expect(listings).toHaveLength(2);
  });

  it("reads the SELLING price, not the strikethrough anchor", () => {
    const l = listings[0];
    expect(l.title).toBe("Rong biển trộn cơm nhập khẩu Hàn Quốc 400g");
    expect(l.priceVnd).toBe(159_000);
    expect(l.originalPriceVnd).toBe(1_250_000);
    // The bug this parser replaces: the old pipeline reported 1.250.000 here.
    expect(l.priceVnd).not.toBe(1_250_000);
  });

  it("reads discount, units sold and review count", () => {
    const l = listings[0];
    expect(l.discountPct).toBe(87);
    expect(l.unitsSold).toBe(2);
    expect(l.reviewCount).toBe(22);
  });

  it("leaves anchor and discount null when the card has no strikethrough", () => {
    const l = listings[1];
    expect(l.priceVnd).toBe(100_000);
    expect(l.originalPriceVnd).toBeNull();
    expect(l.discountPct).toBeNull();
    expect(l.unitsSold).toBe(1);
    expect(l.reviewCount).toBe(1);
  });

  it("keeps the Shopee item id so a retitled listing stays the same listing", () => {
    expect(listings[0].itemId).toBe("18948766171");
    expect(listings[1].itemId).toBe("23658024852");
    expect(listings[0].url).toContain("18948766171");
  });

  it("returns nothing for markup with no cards", () => {
    expect(parseStoreIndex("<html><body>no products</body></html>")).toEqual([]);
  });
});
