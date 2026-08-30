import { describe, expect, it } from "vitest";
import { type Product, resolveByAlias } from "./resolve.js";

// The real seeded SKU and the titles actually observed on kitbuy.
const products: Product[] = [
  {
    sku: "KW-CUON-100LA-250",
    aliases: [
      "Rong biển cuộn cơm 100 lá K-WOOK cao cấp",
      "Rong biển cuộn cơm 100 lá - -",
      "Rong biển Cuộn cơm Hàn Quốc 100 lá 250g - CÓ ZIP -",
      "Rong biển cuộn cơm 100 lá K-wook nhập khẩu Hàn Quốc",
      "Rong biển cuộn cơm 100 Lá Hàn Quốc",
    ],
  },
];

describe("resolveByAlias", () => {
  it("collapses every observed 100-lá variant onto one SKU", () => {
    const observed = [
      "Rong biển cuộn cơm 100 lá K-wook nhập khẩu Hàn Quốc",
      "Rong biển cuộn cơm 100 lá -  -", // two spaces, as it appears on the page
      "Rong biển Cuộn cơm Hàn Quốc 100 lá 250g - CÓ ZIP -",
      "Rong biển cuộn cơm 100 lá K-WOOK cao cấp",
      "Rong biển cuộn cơm  100 Lá Hàn Quốc", // stray double space, as observed
    ];
    for (const t of observed) {
      expect(resolveByAlias(t, products)?.sku).toBe("KW-CUON-100LA-250");
    }
  });

  it("matches through case, diacritics and punctuation", () => {
    expect(resolveByAlias("RONG BIEN CUON COM 100 LA K-WOOK CAO CAP", products)?.sku).toBe(
      "KW-CUON-100LA-250",
    );
  });

  it("costs no tokens - the method is always alias", () => {
    expect(resolveByAlias("Rong biển cuộn cơm 100 lá - -", products)?.method).toBe("alias");
  });

  it("returns null rather than guessing at an unknown title", () => {
    expect(resolveByAlias("Mì Cay Hàn Quốc Shin Ramyun Nongshim", products)).toBeNull();
    expect(resolveByAlias("", products)).toBeNull();
  });
});
