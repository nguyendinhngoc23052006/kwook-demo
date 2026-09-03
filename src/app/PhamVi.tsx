import { LABELS } from "./labels.js";
import type { DetectorRule, EventRow } from "./useDashboard.js";

/**
 * What was checked, and what was not.
 *
 * Nguồn already refuses to collapse a source's three states, on the grounds
 * that "no entry-point URL yet" is not a failure but showing it as healthy is
 * just as wrong. Detectors had no equivalent, and the gap mattered more: an
 * empty Cảnh báo tab reads as "we looked everywhere and everything is fine",
 * when the truth could be that a check never ran. Those are different claims,
 * and only one of them is honest about a detector that is switched off.
 *
 * Three states, from the same rules row the sweep itself obeys:
 *   ran and found something · ran and found nothing · did not run
 */
export function PhamVi({ rules, events }: { rules: DetectorRule[]; events: EventRow[] }) {
  const counts = new Map<string, number>();
  for (const e of events) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);

  return (
    <section className="phamvi">
      <h3>Phạm vi kiểm tra</h3>
      <p className="summary">
        {rules.filter((r) => r.active).length}/{rules.length} phép kiểm tra đang chạy trong mỗi lượt
        quét. Ngưỡng của từng phép nằm trong bảng <code>rules</code> — đổi ở đó là đổi thật.
      </p>
      <ul className="checks">
        {rules.map((r) => {
          const label = LABELS[r.type];
          const found = counts.get(r.type) ?? 0;
          return (
            <li key={r.type} className={r.active ? "on" : "off"}>
              <span className="check-name">{label?.title ?? r.type}</span>
              {!r.active ? (
                <span className="check-state muted">
                  không chạy{label?.offWhy ? ` — ${label.offWhy}` : ""}
                </span>
              ) : found > 0 ? (
                <span className="check-state bad">{found} cảnh báo</span>
              ) : (
                <span className="check-state ok">đã kiểm tra — không phát hiện</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
