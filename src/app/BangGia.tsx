import { count, pct, vnd } from "./format.js";
import { groupBySku, type ListingRow } from "./group.js";
import { LABELS } from "./labels.js";
import type { EventRow, Product } from "./useDashboard.js";

/** Above this spread the cluster is a pricing problem, not normal variation. */
const ALARMING_SPREAD_PCT = 25;

export function BangGia({
  listings,
  products,
  events,
}: {
  listings: ListingRow[];
  products: Product[];
  events: EventRow[];
}) {
  const groups = groupBySku(listings, products);

  // Why a spread is alarming, said where the spread is.
  //
  // The 141,7% cluster is the most damning thing in this data, and on its own
  // a red percentage reads as "several shops disagree" - ordinary competition.
  // What makes it damning is the detector's verdict: ONE seller, five prices.
  // That verdict lived only on Cảnh báo, a tab away, so the number arrived
  // without the reason. These badges carry the reason back.
  const findingsBySku = new Map<string, string[]>();
  for (const e of events) {
    if (e.product_sku === null || e.severity === "info") continue;
    const seen = findingsBySku.get(e.product_sku) ?? [];
    if (!seen.includes(e.type)) findingsBySku.set(e.product_sku, [...seen, e.type]);
  }

  if (groups.length === 0) {
    return (
      <p className="empty">
        Chưa có listing nào khớp được với sản phẩm trong danh mục. Xem tab{" "}
        <strong>Chưa khớp</strong> để duyệt {count(listings.length)} listing đang chờ.
      </p>
    );
  }

  return (
    <div>
      {groups.map((g) => (
        <section key={g.sku} className="sku">
          <header>
            <div>
              <h2>{g.name}</h2>
              <code>{g.sku}</code>
            </div>
            <div className="spread">
              {g.spreadPct === null ? (
                <span className="muted" title="Cần ít nhất hai listing có giá">
                  chỉ 1 listing — không tính được độ phân tán
                </span>
              ) : (
                <span className={g.spreadPct >= ALARMING_SPREAD_PCT ? "bad" : "ok"}>
                  {pct(g.spreadPct)} chênh lệch
                </span>
              )}
              <small>
                {vnd(g.minVnd)} – {vnd(g.maxVnd)} · {g.listings.length} listing
                {g.referencePriceVnd !== null && <> · tham chiếu {vnd(g.referencePriceVnd)}</>}
              </small>
              {(findingsBySku.get(g.sku) ?? []).length > 0 && (
                <div className="why">
                  {(findingsBySku.get(g.sku) ?? []).map((type) => (
                    <span key={type} className="badge" title={LABELS[type]?.why ?? type}>
                      {LABELS[type]?.title ?? type}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </header>

          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>Listing</th>
                  <th className="num">Giá</th>
                  <th className="num">Giá gạch</th>
                  <th className="num">Đã bán</th>
                  <th className="num">Đánh giá</th>
                  <th>Nguồn</th>
                </tr>
              </thead>
              <tbody>
                {g.listings.map((l) => (
                  <tr key={l.listing_url_id}>
                    <td>
                      {l.url ? (
                        <a href={l.url} target="_blank" rel="noreferrer">
                          {l.title_seen ?? "(không có tiêu đề)"}
                        </a>
                      ) : (
                        (l.title_seen ?? "(không có tiêu đề)")
                      )}
                    </td>
                    <td className="num">
                      <strong>{vnd(l.price_vnd)}</strong>
                    </td>
                    <td className="num muted">{vnd(l.original_price_vnd)}</td>
                    <td className="num">{count(l.units_sold)}</td>
                    <td className="num">{count(l.review_count)}</td>
                    <td>{l.source_id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
