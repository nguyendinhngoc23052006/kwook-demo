import { describe, expect, it } from "vitest";
import { mentionsKwook, parseCatalog, parseKwookCatalog } from "./parseCatalog.js";

// Shapes copied from what the runner actually received on 2026-09-02, cut to
// the fields the parser reads. Guessed fixtures would prove nothing here:
// the whole risk in this file is that three platforms disagree about money.
const sapo = JSON.stringify({
  products: [
    {
      id: 81181883,
      name: "CP CHẠO TÔM ĐẶC BIỆT 400G",
      alias: "cp-chao-tom-dac-biet-400g",
      price: 82000.0,
      compare_at_price_max: 0,
      variants: [{ sku: "PVN563", price: 82000.0, compare_at_price: null }],
      url: "/cp-chao-tom-dac-biet-400g",
    },
    {
      id: 2,
      name: "Lá Rong Biển K'WOOK 240G 100 Lá",
      alias: "la-rong-bien-k-wook",
      price: 280000.0,
      compare_at_price_max: 350000.0,
      variants: [{ sku: "KW1", price: 280000.0, compare_at_price: 350000.0 }],
      url: "/la-rong-bien-k-wook",
    },
  ],
});

const shopify = JSON.stringify({
  products: [
    {
      id: 9454172044,
      title: "Rong biển vụn Kwook 400g",
      handle: "rong-bien-vun-kwook-400g",
      variants: [{ sku: "TB-400", price: "190000.00", compare_at_price: null }],
    },
    {
      id: 3,
      title: "Combo 3 món nguyên liệu làm Kimbap",
      handle: "combo-3-mon-nguyen-lieu-lam-kimbap",
      variants: [{ price: "150000.00", compare_at_price: "200000.00" }],
    },
  ],
});

const woo = JSON.stringify([
  {
    id: 399272,
    name: "Ba chỉ bò cuộn 500g – B7039",
    permalink: "https://abby.vn/s/ba-chi-bo-canada-cuon-500g",
    sku: "B7039",
    prices: { price: "319000", regular_price: "319000", currency_minor_unit: 0 },
  },
  {
    id: 4,
    name: "Rong biển ăn liền KWOOK 4,5g",
    permalink: "https://abby.vn/s/la-rong-bien-an-lien-kwook-4-5g",
    sku: "KW45",
    prices: { price: "10800", regular_price: "12000", currency_minor_unit: 0 },
  },
]);

describe("mentionsKwook", () => {
  it("matches every spelling the sellers actually use", () => {
    for (const t of [
      "Rong biển vụn Kwook 400g",
      "Lá Rong Biển K'WOOK 240G 100 Lá",
      "RONG BIỂN CUỘN CƠM HÀN QUỐC K'WOOK 100 LÁ",
      // hunglongmart's own CMS emits four apostrophes; that is their markup.
      "Rong Biển Ăn Liền K-Wook''''S Kid''''S 4.5G*3 Gói",
    ]) {
      expect(mentionsKwook(t)).toBe(true);
    }
  });

  it("rejects the rest of the shop", () => {
    expect(mentionsKwook("CP CHẠO TÔM ĐẶC BIỆT 400G")).toBe(false);
    expect(mentionsKwook("Mành treo tết")).toBe(false);
    expect(mentionsKwook("")).toBe(false);
  });
});

describe("parseCatalog", () => {
  it("reads Sapo prices as đồng, because they already are", () => {
    const items = parseCatalog(sapo, "https://cphfood.vn/collections/all/products.json");
    expect(items).toHaveLength(2);
    expect(items[1]).toMatchObject({
      title: "Lá Rong Biển K'WOOK 240G 100 Lá",
      priceVnd: 280_000,
      originalPriceVnd: 350_000,
      url: "https://cphfood.vn/la-rong-bien-k-wook",
      sellerSku: "KW1",
    });
  });

  it("reads Shopify's major-unit string, and builds the URL from the handle", () => {
    const items = parseCatalog(shopify, "https://tteokbokki.vn/collections/x/products.json");
    expect(items[0]).toMatchObject({
      priceVnd: 190_000,
      originalPriceVnd: null,
      url: "https://tteokbokki.vn/products/rong-bien-vun-kwook-400g",
    });
  });

  it("divides Woo's minor units by the count it reports", () => {
    const items = parseCatalog(woo, "https://abby.vn/wp-json/wc/store/products");
    expect(items[1]).toMatchObject({
      priceVnd: 10_800,
      originalPriceVnd: 12_000,
      url: "https://abby.vn/s/la-rong-bien-an-lien-kwook-4-5g",
    });
  });

  it("honours a non-zero minor unit rather than assuming VND", () => {
    const cents = JSON.stringify([
      { name: "x", permalink: "/x", prices: { price: "1999", currency_minor_unit: 2 } },
    ]);
    expect(parseCatalog(cents, "https://shop.example")[0].priceVnd).toBe(20);
  });

  it("treats Sapo's 0 and Shopify's null compare price as no anchor, not as 0 đ", () => {
    expect(parseCatalog(sapo, "https://cphfood.vn")[0].originalPriceVnd).toBeNull();
    expect(parseCatalog(shopify, "https://tteokbokki.vn")[0].originalPriceVnd).toBeNull();
  });

  it("ignores an anchor below the selling price", () => {
    const odd = JSON.stringify({
      products: [{ name: "y", alias: "y", price: 200_000, compare_at_price_max: 150_000 }],
    });
    expect(parseCatalog(odd, "https://cphfood.vn")[0].originalPriceVnd).toBeNull();
  });

  it("returns null, never 0, for an amount that rounds away", () => {
    // Caught in review: guarding the INPUT alone let 0.3 đồng survive as 0,
    // and a 0 đ price is worse than no price - in_stock reads it as present
    // and every spread divides by a min of zero.
    const tiny = JSON.stringify([
      { name: "z", permalink: "/z", prices: { price: "30", currency_minor_unit: 2 } },
    ]);
    expect(parseCatalog(tiny, "https://shop.example")[0].priceVnd).toBeNull();
  });

  it("returns [] for junk rather than throwing - a changed API costs one source", () => {
    expect(parseCatalog("<html>nope</html>", "https://x.vn")).toEqual([]);
    expect(parseCatalog("{}", "https://x.vn")).toEqual([]);
    expect(parseCatalog('{"products":"not an array"}', "https://x.vn")).toEqual([]);
  });
});

describe("parseKwookCatalog", () => {
  it("keeps only Kwook out of a whole shop", () => {
    expect(parseKwookCatalog(sapo, "https://cphfood.vn").map((i) => i.title)).toEqual([
      "Lá Rong Biển K'WOOK 240G 100 Lá",
    ]);
    expect(parseKwookCatalog(shopify, "https://tteokbokki.vn")).toHaveLength(1);
    expect(parseKwookCatalog(woo, "https://abby.vn")).toHaveLength(1);
  });
});

describe("a shop's JSON is untrusted", () => {
  const wrap = (prices: Record<string, unknown>) =>
    JSON.stringify([{ name: "Rong biển K-WOOK 4.5g", prices }]);

  it("divides by the minor unit when it is well formed", () => {
    const [item] = parseCatalog(wrap({ price: "10800", currency_minor_unit: 2 }), "https://s.vn/x");
    expect(item?.priceVnd).toBe(108);
  });

  it("refuses a negative minor unit rather than multiplying the price", () => {
    // 10 ** -1 is 0.1, and dividing by 0.1 is multiplying by ten: this used
    // to publish 10.800 đ as 108.000 đ, silently and confidently.
    const [item] = parseCatalog(
      wrap({ price: "10800", currency_minor_unit: -1 }),
      "https://s.vn/x",
    );
    expect(item?.priceVnd).toBe(10800);
  });

  it("refuses a fractional minor unit", () => {
    const [item] = parseCatalog(
      wrap({ price: "10800", currency_minor_unit: 1.5 }),
      "https://s.vn/x",
    );
    expect(item?.priceVnd).toBe(10800);
  });
});
