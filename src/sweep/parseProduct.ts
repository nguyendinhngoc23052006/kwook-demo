import { parseVnd } from "../lib/vnd.js";

export type ParsedProduct = {
  title: string | null;
  priceVnd: number | null;
  originalPriceVnd: number | null;
  brandString: string | null;
  /** Which extraction path produced the price — recorded so a wrong one is findable. */
  method: "json-ld" | "meta" | "woocommerce" | null;
};

/**
 * A price string arrives in one of two dialects and confusing them is a
 * 100x error, not a rounding error.
 *
 * Machine markup (JSON-LD, og:price:amount) writes a plain decimal:
 * "289999" or "289999.00", where `.` is a DECIMAL point.
 * Human markup writes Vietnamese: "289.999", where `.` groups thousands.
 *
 * parseVnd strips non-digits, which is right for the human form and turns
 * "289999.00" into 28,999,900 in the machine form. So the shape decides.
 */
export function parsePriceLoose(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const s = raw.trim();
  // A machine decimal: digits, optionally a single dot with 1-2 decimals.
  if (/^\d+(\.\d{1,2})?$/.test(s)) return Math.round(Number.parseFloat(s));
  return parseVnd(s);
}

/** Every JSON-LD node in the document, flattened through @graph and arrays. */
function jsonLdNodes(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const re = /<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    const body = m[1];
    if (!body) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      continue; // a malformed block is skipped, never fatal to the sweep
    }
    const stack = [parsed];
    while (stack.length > 0) {
      const node = stack.pop();
      if (Array.isArray(node)) stack.push(...node);
      else if (node && typeof node === "object") {
        const obj = node as Record<string, unknown>;
        out.push(obj);
        if (obj["@graph"]) stack.push(obj["@graph"]);
      }
    }
  }
  return out;
}

function isProduct(node: Record<string, unknown>): boolean {
  const t = node["@type"];
  if (typeof t === "string") return t.toLowerCase() === "product";
  if (Array.isArray(t))
    return t.some((x) => typeof x === "string" && x.toLowerCase() === "product");
  return false;
}

function firstOffer(node: Record<string, unknown>): Record<string, unknown> | null {
  const offers = node.offers;
  if (Array.isArray(offers)) {
    const first = offers.find((o) => o && typeof o === "object");
    return (first as Record<string, unknown>) ?? null;
  }
  if (offers && typeof offers === "object") return offers as Record<string, unknown>;
  return null;
}

function metaContent(html: string, key: string): string | null {
  // property= and name= both occur; attribute order is not guaranteed.
  //
  // The delimiter is CAPTURED and back-referenced rather than accepting
  // either quote at both ends. Writing the value as [^"']* ends it at the
  // first apostrophe INSIDE the content, which is not a delimiter at all:
  // cphfood.vn's og:title is "Lá Rong Biển K'WOOK 240G 100 Lá" and arrived as
  // "Lá Rong Biển K". Vietnamese product titles carry apostrophes often -
  // K'WOOK, K-WOOK'S - so this silently shortened titles on exactly the
  // sources most likely to use them.
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=(["'])([\\s\\S]*?)\\1`, "i"),
    new RegExp(`<meta[^>]+content=(["'])([\\s\\S]*?)\\1[^>]*(?:property|name)=["']${key}["']`, "i"),
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    if (m?.[2]) return m[2].trim();
  }
  return null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

/**
 * WooCommerce, anchored on the product heading rather than on the first price
 * in the document.
 *
 * That anchor is the whole point. A product page carries prices for the cart
 * widget, related products and upsells; on abby.vn the FIRST
 * `woocommerce-Price-amount` is the header cart total, rendered as `0 ₫`, and
 * the first `class="price"` belongs to a different product entirely — it sits
 * ~9,000 characters before the real one. Taking either would record a
 * confidently wrong number. WooCommerce core always emits
 * `<h1 class="product_title …>` followed by the product's own `<p class="price">`,
 * so the heading is what makes the price identifiable.
 */
function parseWooCommerce(html: string): ParsedProduct | null {
  const titleMatch = /<h1[^>]*class="[^"]*product_title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  if (!titleMatch) return null;

  const after = html.slice(titleMatch.index, titleMatch.index + 6000);
  const block = /<p[^>]*class="[^"]*\bprice\b[^"]*"[^>]*>([\s\S]*?)<\/p>/i.exec(after)?.[1];
  if (!block) return null;

  const amounts = [...block.matchAll(/woocommerce-Price-amount[^>]*>\s*<bdi>\s*([\d.,]+)/gi)].map(
    (m) => parsePriceLoose(m[1]),
  );
  const found = amounts.filter((n): n is number => n !== null);
  if (found.length === 0) return null;

  // A sale renders <del>old</del><ins>new</ins>: the LAST amount is what the
  // buyer pays. With no <del> there is one amount and it is the price.
  const onSale = /<del[\s>]/i.test(block);
  const price = onSale ? (found.at(-1) ?? null) : (found[0] ?? null);

  return {
    title: decodeEntities(titleMatch[1]?.replace(/<[^>]*>/g, "") ?? "") || null,
    priceVnd: price,
    originalPriceVnd: onSale && found.length > 1 ? (found[0] ?? null) : null,
    brandString: null,
    method: "woocommerce",
  };
}

/**
 * Read one product page without knowing the site.
 *
 * Structured markup first, because JSON-LD and OpenGraph are what Vietnamese
 * storefronts (Haravan, WooCommerce, Shopify) emit consistently, while their
 * visible price markup differs per theme. A site emitting neither returns
 * nulls and lands in the unresolved queue rather than a guessed number.
 */
export function parseProductPage(html: string): ParsedProduct {
  for (const node of jsonLdNodes(html)) {
    if (!isProduct(node)) continue;
    const offer = firstOffer(node);
    const rawPrice =
      offer?.price ??
      (offer?.priceSpecification && typeof offer.priceSpecification === "object"
        ? (offer.priceSpecification as Record<string, unknown>).price
        : undefined);
    const price = parsePriceLoose(rawPrice == null ? null : String(rawPrice));
    if (price === null) continue;

    const brand = node.brand;
    const brandName =
      typeof brand === "string"
        ? brand
        : brand && typeof brand === "object"
          ? (((brand as Record<string, unknown>).name as string | undefined) ?? null)
          : null;

    return {
      title: typeof node.name === "string" ? decodeEntities(node.name) : null,
      priceVnd: price,
      originalPriceVnd: parsePriceLoose(offer?.highPrice == null ? null : String(offer.highPrice)),
      brandString: brandName ?? null,
      method: "json-ld",
    };
  }

  const woo = parseWooCommerce(html);
  if (woo?.priceVnd != null) return woo;

  const metaPrice = parsePriceLoose(
    metaContent(html, "product:price:amount") ?? metaContent(html, "og:price:amount"),
  );
  const ogTitle = metaContent(html, "og:title");
  const docTitle = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];

  return {
    title: ogTitle ? decodeEntities(ogTitle) : docTitle ? decodeEntities(docTitle) : null,
    priceVnd: metaPrice,
    originalPriceVnd: null,
    brandString: metaContent(html, "product:brand"),
    method: metaPrice === null ? null : "meta",
  };
}

/**
 * A bot check that answered 200.
 *
 * kwookvietnam.com.vn returns an interstitial titled "Just a moment…" with a
 * 200 status, so the fetch succeeds, the source is recorded as healthy, and
 * an observation with no price is stored forever. A block that reports itself
 * as success is worse than an error: nothing ever surfaces it. These pages
 * are always tiny and always carry a known holding title.
 */
export function looksLikeChallenge(html: string, parsed: ParsedProduct): boolean {
  if (parsed.priceVnd !== null) return false;
  if (html.length > 50_000) return false;
  const title = (parsed.title ?? "").toLowerCase();
  return [
    "just a moment",
    "checking your browser",
    "attention required",
    "verifying you are human",
    "ddos-guard",
    "access denied",
  ].some((needle) => title.includes(needle));
}
