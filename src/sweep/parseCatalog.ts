/**
 * Read a shop's whole catalogue from one request.
 *
 * Every source added so far has been one product per URL, which is why the
 * dashboard grew by four listings when four sellers were added. The shops
 * themselves publish something far better: Shopify, Sapo/Bizweb (a Shopify
 * clone) and WooCommerce all expose a public JSON catalogue, and one request
 * to it returns the whole shop with prices already structured. No HTML, no
 * regex, no fragility when a theme changes.
 *
 * Three shapes, detected rather than configured, because the shop decides
 * which one it speaks and a `platform` column would be one more thing to keep
 * true:
 *
 *   Shopify   {"products":[{title, handle, variants:[{price:"190000.00"}]}]}
 *   Sapo      {"products":[{name,  alias,  price: 190000.0000, variants:[…]}]}
 *   Woo       [{name, permalink, prices:{price:"190000", currency_minor_unit}}]
 *
 * The three disagree about money in a way that silently produces wrong
 * numbers rather than errors, so each is converted explicitly:
 *   - Sapo gives a NUMBER already in đồng.
 *   - Shopify gives a STRING in major units ("190000.00" is 190.000 đ).
 *   - Woo gives a STRING in MINOR units plus the decimal count to divide by;
 *     for a zero-decimal currency like VND that count is 0, but reading the
 *     field beats assuming it.
 */

export type CatalogItem = {
  title: string;
  priceVnd: number | null;
  originalPriceVnd: number | null;
  url: string;
  sellerSku: string | null;
};

/**
 * Is this one of Kwook's?
 *
 * A catalogue endpoint returns the ENTIRE shop - a few Kwook packs among
 * hundreds of unrelated groceries - so unlike a curated product URL, what
 * comes back has to be filtered. This is a POSITIVE test, and deliberately
 * unlike scope.ts, which excludes named competitors and is right to: on a
 * page reached by a Kwook search, a listing with no brand at all is probably
 * still Kwook. Here the default is the opposite, and anything not visibly
 * Kwook would just flood the unresolved queue.
 *
 * Squashing non-alphanumerics first is what makes one test cover every
 * spelling the sellers actually use: Kwook, K-WOOK, K'WOOK, and hunglongmart's
 * "K-Wook''''S" - whose four apostrophes are its own CMS's doing, not ours.
 */
export function mentionsKwook(title: string): boolean {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .includes("kwook");
}

/** A finite, positive number, or null. Guards every price on the way in. */
function money(v: unknown, divisor = 1): number | null {
  const n = typeof v === "string" ? Number.parseFloat(v) : typeof v === "number" ? v : Number.NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n / divisor);
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Absolute already, or relative to the shop we asked. */
function absolute(path: unknown, origin: string): string {
  if (typeof path !== "string" || path === "") return origin;
  if (path.startsWith("http")) return path;
  return `${origin}${path.startsWith("/") ? "" : "/"}${path}`;
}

function firstVariant(p: Record<string, unknown>): Record<string, unknown> {
  const vs = p.variants;
  return Array.isArray(vs) && isRecord(vs[0]) ? vs[0] : {};
}

/**
 * Parse whichever shape came back. Unknown JSON returns [] rather than
 * throwing: a shop that changes its API should cost one source, not the sweep.
 */
export function parseCatalog(body: string, pageUrl: string): CatalogItem[] {
  let doc: unknown;
  try {
    doc = JSON.parse(body);
  } catch {
    return [];
  }

  const origin = (() => {
    try {
      return new URL(pageUrl).origin;
    } catch {
      return "";
    }
  })();

  // WooCommerce Store API: a bare array, each item carrying a `prices` object.
  if (Array.isArray(doc)) {
    return doc.filter(isRecord).flatMap((p) => {
      const prices = isRecord(p.prices) ? p.prices : {};
      const minor = typeof prices.currency_minor_unit === "number" ? prices.currency_minor_unit : 0;
      const divisor = 10 ** minor;
      const title = typeof p.name === "string" ? p.name : "";
      if (title === "") return [];
      const sale = money(prices.price, divisor);
      const regular = money(prices.regular_price, divisor);
      return [
        {
          title,
          priceVnd: sale,
          // Only an anchor if it is genuinely above what the thing sells for.
          originalPriceVnd: regular !== null && sale !== null && regular > sale ? regular : null,
          url: absolute(p.permalink, origin),
          sellerSku: typeof p.sku === "string" && p.sku !== "" ? p.sku : null,
        },
      ];
    });
  }

  if (!isRecord(doc) || !Array.isArray(doc.products)) return [];

  return doc.products.filter(isRecord).flatMap((p) => {
    // Shopify calls it `title` and `handle`; Sapo calls it `name` and `alias`.
    const title = typeof p.title === "string" ? p.title : typeof p.name === "string" ? p.name : "";
    if (title === "") return [];

    const v = firstVariant(p);

    // Sapo puts a ready number on the product; Shopify puts a major-unit
    // string on the variant. Taking the product-level number first is what
    // keeps a Sapo product with several variants reporting its own price.
    const priceVnd = money(p.price) ?? money(v.price);

    // Sapo writes 0 for "no compare price", Shopify writes null; money()
    // rejects both, so neither becomes a fake anchor of 0 đ.
    const compare = money(p.compare_at_price_max) ?? money(v.compare_at_price);

    return [
      {
        title,
        priceVnd,
        originalPriceVnd:
          compare !== null && priceVnd !== null && compare > priceVnd ? compare : null,
        url:
          typeof p.handle === "string"
            ? absolute(`/products/${p.handle}`, origin)
            : absolute(p.url ?? (typeof p.alias === "string" ? `/${p.alias}` : ""), origin),
        sellerSku: typeof v.sku === "string" && v.sku !== "" ? v.sku : null,
      },
    ];
  });
}

/** The catalogue, narrowed to Kwook's own products. */
export function parseKwookCatalog(body: string, pageUrl: string): CatalogItem[] {
  return parseCatalog(body, pageUrl).filter((i) => mentionsKwook(i.title));
}
