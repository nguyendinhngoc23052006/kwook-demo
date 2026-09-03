import { count, vnd } from "./format.js";
import type { ListingRow } from "./group.js";
import type { Proposal } from "./useDashboard.js";

/**
 * Listings the resolver could not tie to a SKU. They are shown, never dropped:
 * an unresolved listing is the one place a silent miss would hide a real
 * pricing problem, so it stays visible until someone claims it.
 */
/** Below this the model is saying "a person should look at this". */
const NEEDS_A_HUMAN = 0.6;

export function ChuaKhop({
  listings,
  proposals,
}: {
  listings: ListingRow[];
  proposals: Proposal[];
}) {
  const proposalFor = new Map(proposals.map((p) => [p.listing_url_id, p]));
  const unresolved = listings.filter((l) => l.product_sku === null && !l.out_of_scope);
  const outOfScope = listings.filter((l) => l.out_of_scope);

  if (unresolved.length === 0 && outOfScope.length === 0) {
    return <p className="empty">Mọi listing đều đã khớp với một sản phẩm trong danh mục.</p>;
  }

  return (
    <div>
      <p className="summary">
        {count(unresolved.length)} / {count(listings.length)} listing đang chờ quyết định — thêm
        tiêu đề vào <code>aliases</code> của sản phẩm để lượt quét sau tự khớp.
        {outOfScope.length > 0 && (
          <>
            {" "}
            {count(outOfScope.length)} listing khác mang thương hiệu không phải Kwook và đã được
            loại khỏi hàng chờ (xem bên dưới).
          </>
        )}
      </p>
      <div className="scroll-x">
        <table>
          <thead>
            <tr>
              <th>Tiêu đề quan sát được</th>
              <th className="num">Giá</th>
              <th>Nguồn</th>
              <th>Đề xuất của mô hình</th>
            </tr>
          </thead>
          <tbody>
            {unresolved.map((l) => {
              const p = proposalFor.get(l.listing_url_id);
              const unsure = p !== undefined && (p.confidence ?? 0) < NEEDS_A_HUMAN;
              return (
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
                  <td>
                    {p === undefined ? (
                      <span className="muted">chưa có đề xuất</span>
                    ) : (
                      <div className="proposal">
                        <div>
                          {p.proposed_sku === null ? (
                            <strong className="warn">không khớp sku nào</strong>
                          ) : (
                            <strong>{p.proposed_sku}</strong>
                          )}
                          {p.confidence !== null && (
                            <span className={unsure ? "badge sev-medium" : "badge"}>
                              {Math.round(p.confidence * 100)}%
                            </span>
                          )}
                        </div>
                        {p.reasoning && <p className="alert-why">{p.reasoning}</p>}
                        <small className="muted">{p.model} · cần người xác nhận</small>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {outOfScope.length > 0 && (
        <>
          <h2 className="section">Ngoài phạm vi — thương hiệu khác</h2>
          <p className="summary">
            Cửa hàng bán cả hàng Hàn Quốc của thương hiệu khác. Những listing này không bao giờ khớp
            được với một SKU của Kwook, nên chúng được tách ra thay vì nằm mãi trong hàng chờ.
          </p>
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>Tiêu đề quan sát được</th>
                  <th>Thương hiệu</th>
                  <th className="num">Giá</th>
                  <th>Nguồn</th>
                </tr>
              </thead>
              <tbody>
                {outOfScope.map((l) => (
                  <tr key={l.listing_url_id}>
                    <td className="muted">{l.title_seen ?? "(không có tiêu đề)"}</td>
                    <td>{l.out_of_scope_brand}</td>
                    <td className="num muted">{vnd(l.price_vnd)}</td>
                    <td>{l.source_id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
