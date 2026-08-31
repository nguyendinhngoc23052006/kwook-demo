import { normalizeTitle } from "../lib/vnd.js";

/**
 * Brands that are not Kwook.
 *
 * The store sells other Korean groceries alongside Kwook's, and those
 * listings can never match a Kwook SKU. Left alone they sit in the
 * unresolved queue forever, so the queue's size stops meaning "work to do"
 * and starts meaning nothing at all.
 *
 * The list is EXPLICIT on purpose. The tempting rule — "no Kwook word in the
 * title means it is not Kwook" — is wrong on this very data: several genuine
 * Kwook listings carry no brand at all ("Rong biển cuộn cơm 100 lá - -" is
 * one of the five in the self-cannibalisation cluster). Excluding by a named
 * competitor is the only version that cannot silently drop a real product.
 */
const OTHER_BRANDS = ["nongshim", "gimfood", "nongwoo", "gogi", "ottogi", "cj", "bibigo"];

export type ScopeVerdict = { outOfScope: true; brand: string } | { outOfScope: false };

/** Names a competitor brand → out of scope. Says nothing otherwise. */
export function classifyScope(title: string): ScopeVerdict {
  const words = new Set(normalizeTitle(title).split(" "));
  for (const brand of OTHER_BRANDS) {
    if (words.has(brand)) return { outOfScope: true, brand };
  }
  return { outOfScope: false };
}
