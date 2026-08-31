-- The vietmart entry point was recorded without the /amp/ path segment and the
-- host refused the connection outright ("fetch failed", not an HTTP status).
-- The AMP path is the one that actually resolves.
update listing_urls
   set url = 'https://vietmart.co/amp/rong-bien-han-quoc-k-wook-s-cuon-kimbap-24g-10-la-s11990057393.html'
 where url = 'https://vietmart.co/rong-bien-han-quoc-k-wook-s-cuon-kimbap-24g-10-la-s11990057393.html';
