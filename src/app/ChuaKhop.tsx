import { count, vnd } from "./format.js";
import type { ListingRow } from "./group.js";

/**
 * Listings the resolver could not tie to a SKU. They are shown, never dropped:
 * an unresolved listing is the one place a silent miss would hide a real
 * pricing problem, so it stays visible until someone claims it.
 */
export function ChuaKhop({ listings }: { listings: ListingRow[] }) {
  const unresolved = listings.filter((l) => l.product_sku === null);

  if (unresolved.length === 0) {
    return <p className="empty">Mọi listing đều đã khớp với một sản phẩm trong danh mục.</p>;
  }

  return (
    <div>
      <p className="summary">
        {count(unresolved.length)} / {count(listings.length)} listing chưa khớp được với sản phẩm
        nào. Thêm tiêu đề vào <code>aliases</code> của sản phẩm để lượt quét sau tự khớp.
      </p>
      <table>
        <thead>
          <tr>
            <th>Tiêu đề quan sát được</th>
            <th className="num">Giá</th>
            <th>Nguồn</th>
          </tr>
        </thead>
        <tbody>
          {unresolved.map((l) => (
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
              <td className="num">{vnd(l.price_vnd)}</td>
              <td>{l.source_id}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
