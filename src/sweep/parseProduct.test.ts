import { describe, expect, it } from "vitest";
import { parsePriceLoose, parseProductPage } from "./parseProduct.js";

describe("parsePriceLoose", () => {
  it("reads a machine decimal as a decimal, not as grouped thousands", () => {
    // The 100x trap: parseVnd would make this 28,999,900.
    expect(parsePriceLoose("289999.00")).toBe(289_999);
    expect(parsePriceLoose("289999")).toBe(289_999);
  });

  it("reads Vietnamese grouping as thousands", () => {
    expect(parsePriceLoose("289.999 đ")).toBe(289_999);
    expect(parsePriceLoose("1.250.000")).toBe(1_250_000);
  });

  it("rounds a machine decimal rather than truncating", () => {
    expect(parsePriceLoose("120000.60")).toBe(120_001);
  });

  it("returns null for nothing usable", () => {
    expect(parsePriceLoose(null)).toBeNull();
    expect(parsePriceLoose("")).toBeNull();
    expect(parsePriceLoose("liên hệ")).toBeNull();
  });
});

const jsonLd = (obj: unknown) =>
  `<html><head><script type="application/ld+json">${JSON.stringify(obj)}</script></head></html>`;

describe("parseProductPage", () => {
  it("reads a plain JSON-LD Product", () => {
    const out = parseProductPage(
      jsonLd({
        "@type": "Product",
        name: "Rong biển cuộn cơm 100 lá",
        brand: { name: "K-wook" },
        offers: { "@type": "Offer", price: "289999", priceCurrency: "VND" },
      }),
    );
    expect(out).toMatchObject({
      title: "Rong biển cuộn cơm 100 lá",
      priceVnd: 289_999,
      brandString: "K-wook",
      method: "json-ld",
    });
  });

  it("finds a Product nested in @graph", () => {
    const out = parseProductPage(
      jsonLd({
        "@graph": [
          { "@type": "WebSite", name: "Abby" },
          { "@type": "Product", name: "Lá rong biển Kwook", offers: { price: "35000" } },
        ],
      }),
    );
    expect(out.priceVnd).toBe(35_000);
    expect(out.title).toBe("Lá rong biển Kwook");
  });

  it("takes the first offer when offers is an array", () => {
    const out = parseProductPage(
      jsonLd({ "@type": "Product", name: "x", offers: [{ price: "50000" }, { price: "90000" }] }),
    );
    expect(out.priceVnd).toBe(50_000);
  });

  it("reads a price nested under priceSpecification", () => {
    const out = parseProductPage(
      jsonLd({
        "@type": "Product",
        name: "x",
        offers: { priceSpecification: { price: "75000" } },
      }),
    );
    expect(out.priceVnd).toBe(75_000);
  });

  it("accepts @type given as an array", () => {
    const out = parseProductPage(
      jsonLd({ "@type": ["Product", "Thing"], name: "x", offers: { price: "10000" } }),
    );
    expect(out.priceVnd).toBe(10_000);
  });

  it("skips a malformed JSON-LD block instead of throwing", () => {
    const html = `<script type="application/ld+json">{ not json </script>
      <meta property="product:price:amount" content="42000">`;
    expect(parseProductPage(html).priceVnd).toBe(42_000);
  });

  it("falls back to OpenGraph meta when there is no JSON-LD", () => {
    const out = parseProductPage(
      `<meta property="og:title" content="Rong biển K-wook 10 lá">
       <meta property="og:price:amount" content="24000">`,
    );
    expect(out).toMatchObject({
      title: "Rong biển K-wook 10 lá",
      priceVnd: 24_000,
      method: "meta",
    });
  });

  it("reads meta tags with content before the property attribute", () => {
    const out = parseProductPage(`<meta content="31000" property="product:price:amount">`);
    expect(out.priceVnd).toBe(31_000);
  });

  it("falls back to the document title and reports no price", () => {
    const out = parseProductPage(
      "<html><head><title>Sản phẩm &amp; quà tặng</title></head></html>",
    );
    expect(out).toMatchObject({ title: "Sản phẩm & quà tặng", priceVnd: null, method: null });
  });

  it("ignores a Product whose offer carries no usable price", () => {
    const html = jsonLd({ "@type": "Product", name: "x", offers: { price: "Liên hệ" } }).replace(
      "</head>",
      '<meta property="og:price:amount" content="99000"></head>',
    );
    expect(parseProductPage(html).priceVnd).toBe(99_000);
  });
});
