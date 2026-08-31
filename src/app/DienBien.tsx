import { ago, count, vnd, when } from "./format.js";
import { changesBetween, type Snapshot } from "./history.js";
import type { Sweep } from "./useDashboard.js";

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
  const changes = changesBetween(history);
  const span = sweepHistory.at(-1)?.started_at;

  return (
    <div>
      <h2 className="section">Thay đổi</h2>
      {changes.length === 0 ? (
        <p className="empty">
          Không có thay đổi nào về giá hay lượt bán trong {count(sweepHistory.length)} lượt quét gần
          nhất{span && <> (từ {when(span)})</>}. Thị trường đứng yên — sẽ hiện ở đây ngay khi có
          biến động.
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Thời điểm</th>
              <th>Listing</th>
              <th>Thay đổi</th>
              <th className="num">Từ</th>
              <th className="num">Thành</th>
            </tr>
          </thead>
          <tbody>
            {changes.map((c) => (
              <tr key={`${c.listing_url_id}-${c.observed_at}-${c.field}`}>
                <td className="muted">{when(c.observed_at)}</td>
                <td>{c.title}</td>
                <td>{c.field === "price" ? "giá" : "đã bán"}</td>
                <td className="num muted">{c.field === "price" ? vnd(c.from) : count(c.from)}</td>
                <td className="num">
                  <strong>{c.field === "price" ? vnd(c.to) : count(c.to)}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 className="section">Nhật ký quét</h2>
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
              <td className={s.finished_at === null ? "warn" : "muted"}>
                {s.finished_at === null ? "đang chạy" : when(s.finished_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
