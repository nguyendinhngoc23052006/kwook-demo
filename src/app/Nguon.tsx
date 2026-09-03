import { ago, count } from "./format.js";
import type { Source } from "./useDashboard.js";

/** Three consecutive failures flip a source inactive; that is stated, not hidden. */
const FAILURE_LIMIT = 3;

/**
 * A source has three distinct states, and collapsing them misreports the
 * system. "No entry-point URL yet" is not a failure — nothing was attempted —
 * but showing it as healthy is just as wrong, because it will never return
 * data until someone adds a URL.
 */
function state(s: Source, entryPoints: number) {
  if (entryPoints === 0) return { kind: "unconfigured" as const };
  if (!s.active) return { kind: "off" as const };
  if (s.consecutive_failures > 0) return { kind: "failing" as const };
  return { kind: "ok" as const };
}

export function Nguon({
  sources,
  urlsBySource,
  entryPointsBySource,
}: {
  sources: Source[];
  urlsBySource: Record<string, number>;
  entryPointsBySource: Record<string, number>;
}) {
  if (sources.length === 0) return <p className="empty">Chưa cấu hình nguồn nào.</p>;

  // Configured means "has something to fetch", not "has rows in the table".
  const unconfigured = sources.filter((s) => (entryPointsBySource[s.id] ?? 0) === 0).length;

  return (
    <div>
      {unconfigured > 0 && (
        <p className="summary">
          {count(unconfigured)} nguồn chưa có điểm vào nào để quét — chúng bị bỏ qua, không phải bị
          lỗi. Thêm một URL điểm vào cho mỗi nguồn thì lượt quét sau sẽ tự lấy dữ liệu.
        </p>
      )}
      <div className="scroll-x">
        <table>
          <thead>
            <tr>
              <th>Nguồn</th>
              <th>Tên miền</th>
              <th className="num">Điểm vào</th>
              <th className="num">Listing</th>
              <th>Trạng thái</th>
              <th>Lần quét thành công gần nhất</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => {
              const urls = urlsBySource[s.id] ?? 0;
              const entryPoints = entryPointsBySource[s.id] ?? 0;
              const st = state(s, entryPoints);
              return (
                <tr key={s.id}>
                  <td>{s.display_name}</td>
                  <td className="muted">{s.domain}</td>
                  {/* One fetch, many listings: kitbuy reads a store index and
                    tteokbokki a JSON catalogue, so a single entry point stands
                    behind dozens of tracked products. Showing both numbers is
                    what makes that visible rather than surprising. */}
                  <td className={entryPoints === 0 ? "num muted" : "num"}>{count(entryPoints)}</td>
                  <td className={urls === 0 ? "num muted" : "num"}>{count(urls)}</td>
                  <td>
                    {st.kind === "unconfigured" && (
                      <span className="muted">chưa cấu hình URL — chưa từng quét</span>
                    )}
                    {st.kind === "off" && (
                      <span className="bad">
                        đã tắt — {s.consecutive_failures} lần lỗi liên tiếp (ngưỡng {FAILURE_LIMIT})
                      </span>
                    )}
                    {st.kind === "failing" && (
                      <span className="warn">{s.consecutive_failures} lần lỗi liên tiếp</span>
                    )}
                    {st.kind === "ok" && <span className="ok">đang hoạt động</span>}
                  </td>
                  <td className={s.last_success_at === null ? "muted" : ""}>
                    {ago(s.last_success_at)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
