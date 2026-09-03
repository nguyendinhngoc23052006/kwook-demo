import { ago, count, vnd, when } from "./format.js";
import { changesBetween, type Snapshot } from "./history.js";
import { type Sweep, wasInterrupted } from "./useDashboard.js";

/**
 * Two records, not a chart. Prices on a store index move rarely, so a graph of
 * them is mostly a flat line — while the fact that the pipeline ran unattended
 * every hour, and caught the moment anything moved, is the thing worth showing.
 */
export function DienBien({
  sweepHistory,
  history,
}: {
  sweepHistory: Sweep[];
  history: Snapshot[];
}) {
  const all = changesBetween(history);
  // A seller moving a price is news. Our parser starting or stopping to read
  // one is housekeeping. They are separated rather than interleaved, because
  // a reader scanning for market moves should not have to tell them apart.
  const moves = all.filter((c) => c.kind === "price" || c.kind === "units_sold");
  const parserNotes = all.filter((c) => c.kind === "first_price" || c.kind === "price_lost");
  const span = sweepHistory.at(-1)?.started_at;

  return (
    <div>
      <h2 className="section">Thay đổi giá &amp; lượt bán</h2>
      {moves.length === 0 ? (
        <p className="empty">
          Không có người bán nào đổi giá hay bán thêm trong {count(sweepHistory.length)} lượt quét
          gần nhất{span && <> (từ {when(span)})</>}. Thị trường đứng yên — sẽ hiện ở đây ngay khi có
          biến động.
        </p>
      ) : (
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>Thời điểm</th>
                <th>Nguồn</th>
                <th>Listing</th>
                <th>Sản phẩm</th>
                <th>Thay đổi</th>
                <th className="num">Từ</th>
                <th className="num">Thành</th>
              </tr>
            </thead>
            <tbody>
              {moves.map((c) => (
                <tr key={`${c.listing_url_id}-${c.observed_at}-${c.kind}`}>
                  <td className="muted">{when(c.observed_at)}</td>
                  <td>
                    <strong>{c.source_id}</strong>
                  </td>
                  <td>{c.title}</td>
                  <td className="muted">{c.product_sku ?? "chưa khớp"}</td>
                  <td>{c.kind === "price" ? "đổi giá" : "bán thêm"}</td>
                  <td className="num muted">{c.kind === "price" ? vnd(c.from) : count(c.from)}</td>
                  <td className="num">
                    <strong>{c.kind === "price" ? vnd(c.to) : count(c.to)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {parserNotes.length > 0 && (
        <>
          <h2 className="section">Thay đổi ở phía thu thập</h2>
          <p className="summary">
            Không phải người bán đổi gì — đây là những listing mà hệ thống bắt đầu (hoặc thôi) đọc
            được giá. Ghi lại để một lỗi bóc tách không trôi qua im lặng.
          </p>
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>Thời điểm</th>
                  <th>Nguồn</th>
                  <th>Listing</th>
                  <th>Việc gì xảy ra</th>
                  <th className="num">Giá đọc được</th>
                </tr>
              </thead>
              <tbody>
                {parserNotes.map((c) => (
                  <tr key={`${c.listing_url_id}-${c.observed_at}-${c.kind}`}>
                    <td className="muted">{when(c.observed_at)}</td>
                    <td>
                      <strong>{c.source_id}</strong>
                    </td>
                    <td>{c.title}</td>
                    <td className={c.kind === "price_lost" ? "warn" : "muted"}>
                      {c.kind === "first_price" ? "lần đầu đọc được giá" : "không còn đọc được giá"}
                    </td>
                    <td className="num">
                      {c.kind === "first_price" ? <strong>{vnd(c.to)}</strong> : vnd(c.from)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2 className="section">Nhật ký quét</h2>
      <div className="scroll-x">
        <table>
          <thead>
            <tr>
              <th>Bắt đầu</th>
              <th>Cách đây</th>
              <th className="num">Nguồn OK</th>
              <th className="num">Listing</th>
              <th>Kết thúc</th>
            </tr>
          </thead>
          <tbody>
            {sweepHistory.map((s) => (
              <tr key={s.id}>
                <td>{when(s.started_at)}</td>
                <td className="muted">{ago(s.started_at)}</td>
                <td className="num">
                  {s.sources_ok}/{s.sources_attempted}
                </td>
                <td className="num">{count(s.listings_observed)}</td>
                <td className={s.finished_at === null || wasInterrupted(s) ? "warn" : "muted"}>
                  {wasInterrupted(s)
                    ? "bị gián đoạn"
                    : s.finished_at === null
                      ? "đang chạy"
                      : when(s.finished_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
