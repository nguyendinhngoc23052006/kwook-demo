/** HTML -> plain text. Pure and testable; the biggest cost lever before extraction. */
export function clean(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<(nav|header|footer)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/[ \t ]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

/**
 * Split a store-index page into per-listing text blocks.
 * Heuristic for night one: cut on the Vietnamese currency marker, which ends
 * every product card. Replaced by a fixture-driven parser once we have a
 * saved kitbuy page to test against.
 */
export function splitListings(text: string, cap = 8000): string[] {
  const parts = text
    .split(/(?<=[\d.]{4,}\s*[₫đ])\s*/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 40 && /[\d.]{4,}\s*[₫đ]/u.test(s));
  return (parts.length ? parts : [text]).map((s) => s.slice(0, cap));
}
