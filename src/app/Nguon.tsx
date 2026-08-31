import { ago } from "./format.js";
import type { Source } from "./useDashboard.js";

/** Three consecutive failures flip a source inactive; that is stated, not hidden. */
const FAILURE_LIMIT = 3;

export function Nguon({ sources }: { sources: Source[] }) {
  if (sources.length === 0) return <p className="empty">Chưa cấu hình nguồn nào.</p>;

  return (
    <table>
      <thead>
        <tr>
          <th>Nguồn</th>
          <th>Tên miền</th>
          <th>Trạng thái</th>
          <th>Lần quét thành công gần nhất</th>
        </tr>
      </thead>
      <tbody>
        {sources.map((s) => (
          <tr key={s.id}>
            <td>{s.display_name}</td>
            <td className="muted">{s.domain}</td>
            <td>
              {!s.active ? (
                <span className="bad">
                  đã tắt — {s.consecutive_failures} lần lỗi liên tiếp (ngưỡng {FAILURE_LIMIT})
                </span>
              ) : s.consecutive_failures > 0 ? (
                <span className="warn">{s.consecutive_failures} lần lỗi liên tiếp</span>
              ) : (
                <span className="ok">đang hoạt động</span>
              )}
            </td>
            <td className={s.last_success_at === null ? "muted" : ""}>{ago(s.last_success_at)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
