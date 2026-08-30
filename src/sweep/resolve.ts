import { normalizeTitle } from "../lib/vnd.js";

export type Product = { sku: string; aliases: string[] };
export type Resolution = { sku: string; confidence: number; method: "alias" } | null;

/**
 * Alias-first resolution. An exact match on the normalised title costs zero
 * tokens, and every confirmed match appends an alias - so the model is needed
 * less each night rather than more.
 *
 * Titles that miss go to the unresolved queue (product_sku stays null) rather
 * than being guessed at. Merging two genuinely different pack variants is
 * worse than leaving one unresolved.
 */
export function resolveByAlias(title: string, products: Product[]): Resolution {
  const needle = normalizeTitle(title);
  if (needle === "") return null;
  for (const p of products) {
    if (p.aliases.some((a) => normalizeTitle(a) === needle)) {
      return { sku: p.sku, confidence: 1, method: "alias" };
    }
  }
  return null;
}
