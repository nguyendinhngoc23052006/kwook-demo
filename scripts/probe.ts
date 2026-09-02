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
  console.error("usage: npm run probe -- [--peek] <url> [url...]");
  process.exit(2);
}

/**
 * --peek prints what came back instead of judging it.
 *
 * The verdict mode below answers "can the product parser read this page?",
 * which is the right question for a product URL and the wrong one for
 * anything else. Catalogue endpoints - Shopify's /products.json, Sapo's copy
 * of it, WooCommerce's Store API - are the shape worth having, because one
 * request returns a whole shop rather than one item. Judging those with a
 * single-product parser would report NO PRICE on exactly the URLs worth
 * adding.
 *
 * The excerpt is bounded and goes to the job log rather than an artifact:
 * this repo's only window onto these hosts is the runner, since the sandbox
 * Claude works in is refused by every Vietnamese e-commerce site (CONNECT
 * 403), and a log is readable from there without downloading anything.
 */
const peek = process.argv.includes("--peek");
const PEEK_CHARS = 1600;

if (peek) {
  for (const url of urls) {
    const res = await fetchPage(url);
    if (!res.ok) {
      console.log(`DEAD      ${url}\n          fetch failed: ${res.error}\n`);
      continue;
    }
    const body = res.html;
    const looksJson = body.trimStart().startsWith("{") || body.trimStart().startsWith("[");
    console.log(
      `OK        ${url}\n          ${body.length} chars, ${looksJson ? "JSON" : "not JSON"}\n` +
        `--- first ${PEEK_CHARS} chars ---\n${body.slice(0, PEEK_CHARS)}\n--- end ---\n`,
    );
    await new Promise((r) => setTimeout(r, 2000));
  }
  process.exit(0);
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
