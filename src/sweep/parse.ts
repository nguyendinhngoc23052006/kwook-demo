import { parseVnd } from "../lib/vnd.js";

export type ParsedListing = {
  /** Shopee item id from the product href - stable across title edits. */
  itemId: string | null;
  url: string | null;
  title: string;
  priceVnd: number | null;
  originalPriceVnd: number | null;
  discountPct: number | null;
  unitsSold: number | null;
  reviewCount: number | null;
};

const CARD = '<div class="card shadow-0 background-white padding-bottom-8">';

/**
 * Deterministic parse of the kitbuy store index. No model call, so it costs
 * nothing per sweep and cannot hallucinate a price.
 *
 * The distinction that matters: the strikethrough anchor is a <del> element,
 * while the real selling price is the one carrying `text-strong text-4`. The
 * earlier text pipeline collapsed both to "the number near the title" and kept
 * the wrong one, reporting products at up to 8x their price.
 */
export function parseStoreIndex(html: string): ParsedListing[] {
  return html
    .split(CARD)
    .slice(1) // everything before the first card marker is page chrome
    .map(parseCard)
    .filter((l): l is ParsedListing => l !== null);
}

function parseCard(card: string): ParsedListing | null {
  const title = /title="([^"]+)"/.exec(card)?.[1]?.trim();
  if (!title) return null;

  // Sale price: the `text-strong text-4` paragraph. Never the <del>.
  const price = /text-strong text-4"[^>]*>\s*([\d.]+)/.exec(card)?.[1];
  // Anchor: present only when the listing shows a strikethrough.
  const anchor = /<del[^>]*>([^<]*)<\/del>/.exec(card)?.[1];
  const discount = /"[^"]*text-danger[^"]*"[^>]*>\s*-?(\d+(?:[.,]\d+)?)%/.exec(card)?.[1];
  const sold = /Đã bán<\/span>\s*<span[^>]*>\s*([\d.]+)/u.exec(card)?.[1];
  const reviews = /text-1 padding-left-1"[^>]*>\s*\(\s*([\d.]+)\s*\)/.exec(card)?.[1];
  const itemId = /-i\.\d+\.(\d+)/.exec(card)?.[1] ?? null;

  return {
    itemId,
    url: itemId ? `https://kitbuy.vn/i.19585311.${itemId}` : null,
    title,
    priceVnd: parseVnd(price),
    originalPriceVnd: parseVnd(anchor),
    discountPct: discount ? Number(discount.replace(",", ".")) : null,
    unitsSold: parseVnd(sold),
    reviewCount: parseVnd(reviews),
  };
}
