/**
 * Vietnamese money and count parsing.
 * "42.120 ₫" is 42120, not 42.12 - the dot is a thousands separator, so
 * parseFloat and parseInt are both wrong here. Strip every non-digit instead.
 */
export function parseVnd(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length > 0 ? Number.parseInt(digits, 10) : null;
}

/** "Đã bán 1.240" -> 1240; "Đã bán 1" -> 1; absent -> null. */
export function parseUnitsSold(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = /Đã bán\s*([\d.]+)/iu.exec(raw);
  return m ? parseVnd(m[1]) : null;
}

/**
 * Fold a Vietnamese title to a comparison key.
 * đ/Đ is a distinct letter, not d plus a diacritic, so NFD leaves it intact -
 * it has to be replaced explicitly or alias matching silently misses.
 */
export function normalizeTitle(raw: string): string {
  return raw
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
