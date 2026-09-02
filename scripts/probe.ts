/**
 * Does this URL actually give us a price? Answer before committing it.
 *
 * A source row that 404s, or that answers 200 with a bot-challenge page, costs
 * a fetch every hour forever and shows up on the dashboard as a dead source.
 * Five URLs were once added from a search-results page without being opened;
 * one of them worked. This script exists so that cannot happen twice.
 *
 * It runs the REAL fetcher and the REAL parser - the same code the sweep uses -
 * so a pass here means the sweep will get the same answer.
 *
 *   npm run probe -- https://example.com/product-a https://example.com/product-b
 */
import { fetchPage } from "../src/sweep/fetchSource.js";
import { looksLikeChallenge, parseProductPage } from "../src/sweep/parseProduct.js";

const urls = process.argv.slice(2).filter((a) => a.startsWith("http"));
if (urls.length === 0) {
  console.error("usage: npm run probe -- <url> [url...]");
  process.exit(2);
}

let usable = 0;

for (const url of urls) {
  const res = await fetchPage(url);

  if (!res.ok) {
    console.log(`DEAD      ${url}\n          fetch failed: ${res.error}`);
    continue;
  }

  const p = parseProductPage(res.html);

  if (looksLikeChallenge(res.html, p)) {
    console.log(`BLOCKED   ${url}\n          bot challenge ("${p.title ?? "no title"}")`);
    continue;
  }

  if (p.priceVnd === null) {
    console.log(
      `NO PRICE  ${url}\n          fetched ${res.html.length} chars but no price found` +
        ` (title: ${p.title ?? "none"}, method: ${p.method ?? "none"})`,
    );
    continue;
  }

  usable++;
  console.log(
    `USABLE    ${url}\n          ${p.priceVnd.toLocaleString("vi-VN")} đ` +
      `${p.originalPriceVnd ? ` (was ${p.originalPriceVnd.toLocaleString("vi-VN")} đ)` : ""}` +
      ` | ${p.method} | ${p.title ?? "no title"}`,
  );

  // Be a polite crawler here too: this script can be pointed at a dozen URLs.
  await new Promise((r) => setTimeout(r, 2000));
}

console.log(`\n${usable}/${urls.length} usable`);
process.exit(usable === urls.length ? 0 : 1);
