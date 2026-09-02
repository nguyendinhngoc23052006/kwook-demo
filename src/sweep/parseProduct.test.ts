import { describe, expect, it } from "vitest";
import { looksLikeChallenge, parsePriceLoose, parseProductPage } from "./parseProduct.js";

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

// Reproduces abby.vn's real shape: a header cart total of 0 đ, then a
// DIFFERENT product's price block, and only then the product's own heading
// and price. Both decoys precede the real one in the document.
const wooPage = (priceBlock: string) => `
<html><body>
  <span class="woocommerce-Price-amount amount"><bdi>0&nbsp;<span class="woocommerce-Price-currencySymbol">&#8363;</span></bdi></span>
  <div class="related">
    <p class="price"><span class="woocommerce-Price-amount amount"><bdi>135.000&nbsp;<span>&#8363;</span></bdi></span></p>
  </div>
  <h1 class="product_title entry-title elementor-heading-title">Lá rong biển Kwook (10 lá)</h1>
  <div class="elementor-widget-container">${priceBlock}</div>
</body></html>`;

describe("parseProductPage on WooCommerce", () => {
  it("takes the price after the product heading, not the cart total or a related product", () => {
    const out = parseProductPage(
      wooPage(
        '<p class="price"><span class="woocommerce-Price-amount amount"><bdi>34.560&nbsp;<span class="woocommerce-Price-currencySymbol">&#8363;</span></bdi></span><br/><small>(Giá khu vực )</small></p>',
      ),
    );
    expect(out).toMatchObject({
      title: "Lá rong biển Kwook (10 lá)",
      priceVnd: 34_560,
      method: "woocommerce",
    });
    expect(out.priceVnd).not.toBe(0);
    expect(out.priceVnd).not.toBe(135_000);
  });

  it("takes the sale price, not the struck-through one", () => {
    const out = parseProductPage(
      wooPage(
        '<p class="price"><del><span class="woocommerce-Price-amount amount"><bdi>50.000&nbsp;<span>&#8363;</span></bdi></span></del> <ins><span class="woocommerce-Price-amount amount"><bdi>34.560&nbsp;<span>&#8363;</span></bdi></span></ins></p>',
      ),
    );
    expect(out).toMatchObject({ priceVnd: 34_560, originalPriceVnd: 50_000 });
  });

  it("reads Vietnamese grouping, so 42.120 is not 42", () => {
    const out = parseProductPage(
      wooPage(
        '<p class="price"><span class="woocommerce-Price-amount amount"><bdi>42.120&nbsp;<span>&#8363;</span></bdi></span></p>',
      ),
    );
    expect(out.priceVnd).toBe(42_120);
  });

  it("returns no price when the heading has no price block after it", () => {
    const out = parseProductPage(
      '<h1 class="product_title">Sản phẩm</h1><div>Liên hệ để biết giá</div>',
    );
    expect(out.priceVnd).toBeNull();
    expect(out.method).toBeNull();
  });

  it("prefers JSON-LD when a page offers both", () => {
    const html = wooPage(
      '<p class="price"><span class="woocommerce-Price-amount amount"><bdi>34.560&nbsp;<span>&#8363;</span></bdi></span></p>',
    ).replace(
      "<body>",
      `<body><script type="application/ld+json">${JSON.stringify({ "@type": "Product", name: "x", offers: { price: "99000" } })}</script>`,
    );
    expect(parseProductPage(html)).toMatchObject({ priceVnd: 99_000, method: "json-ld" });
  });
});

describe("looksLikeChallenge", () => {
  const small = "<html><head><title>Just a moment… — OnePanel</title></head></html>";

  it("flags a tiny interstitial that answered 200", () => {
    expect(looksLikeChallenge(small, parseProductPage(small))).toBe(true);
  });

  it("does not flag a real page that simply has no price", () => {
    const html = "<html><head><title>Rong biển Kwook 50g</title></head></html>";
    expect(looksLikeChallenge(html, parseProductPage(html))).toBe(false);
  });

  it("does not flag a page that produced a price", () => {
    const html = `<html><head><title>Just a moment…</title>
      <meta property="og:price:amount" content="42000"></head></html>`;
    expect(looksLikeChallenge(html, parseProductPage(html))).toBe(false);
  });

  it("does not flag a large page, since a challenge is never large", () => {
    const html = `${small}${"x".repeat(60_000)}`;
    expect(looksLikeChallenge(html, parseProductPage(html))).toBe(false);
  });
});

describe("meta titles containing an apostrophe", () => {
  // Verbatim shape from cphfood.vn, found by the probe: the title arrived as
  // "Lá Rong Biển K" because the old pattern treated the apostrophe in K'WOOK
  // as the closing delimiter.
  const html = `<html><head>
    <meta property="og:title" content="Lá Rong Biển K'WOOK 240G 100 Lá | CPH FOOD">
    <meta property="product:price:amount" content="280000">
  </head><body></body></html>`;

  it("keeps the whole title", () => {
    expect(parseProductPage(html).title).toBe("Lá Rong Biển K'WOOK 240G 100 Lá | CPH FOOD");
  });

  it("still reads the price", () => {
    expect(parseProductPage(html).priceVnd).toBe(280_000);
  });

  it("handles single-quoted attributes carrying a double quote", () => {
    const q = `<html><head><meta property='og:title' content='Rong biển "gói to" 400g'>
      <meta property='og:price:amount' content='190000'></head></html>`;
    expect(parseProductPage(q).title).toBe('Rong biển "gói to" 400g');
  });
});
