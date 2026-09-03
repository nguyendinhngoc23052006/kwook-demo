import { count } from "./format.js";
import type { ListingRow } from "./group.js";
import { LABELS } from "./labels.js";
import type { EventRow } from "./useDashboard.js";

const SEVERITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

export function CanhBao({ events, listings }: { events: EventRow[]; listings: ListingRow[] }) {
  if (events.length === 0) {
    return <p className="empty">Không có cảnh báo nào trong lượt quét gần nhất. Đêm yên tĩnh.</p>;
  }

  const titleFor = new Map(listings.map((l) => [l.listing_url_id, l.title_seen]));
  const sorted = [...events].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
  );

  const high = sorted.filter((e) => e.severity === "high").length;

  return (
    <div>
      <p className="summary">
        {count(sorted.length)} cảnh báo
        {high > 0 && (
          <>
            {" "}
            · <span className="bad">{count(high)} nghiêm trọng</span>
          </>
        )}
      </p>
      <ul className="alerts">
        {sorted.map((e) => {
          const label = LABELS[e.type];
          // A listing-scoped finding names the listing; a SKU-scoped one names
          // the SKU. Falling back to a bare word like "listing" would read as a
          // label rather than the miss it actually is, so say the miss.
          const subject =
            e.listing_url_id !== null
              ? (titleFor.get(e.listing_url_id) ?? "(listing không có trong lượt quét này)")
              : (e.product_sku ?? "—");
          return (
            <li key={e.id} className={`sev-${e.severity}`}>
              <div className="alert-head">
                <strong>{label?.title ?? e.type}</strong>
                <span className={`badge sev-${e.severity}`}>{e.severity}</span>
              </div>
              <div className="alert-subject">{subject}</div>
              {/* new_seller has no previous value, and a bare "→ title" reads
                  as a truncated line rather than a first sighting. */}
              <div className="alert-values">
                {e.old_value !== null && `${e.old_value} → `}
                <strong>{e.new_value}</strong>
              </div>
              {/* The model's sentence when there is one, the fixed
                  per-detector sentence when there is not. A sweep that ran
                  without a model looks exactly like it always did. */}
              {e.explanation ? (
                <p className="alert-why written" title={`viết bởi ${e.explained_by ?? "mô hình"}`}>
                  {e.explanation}
                </p>
              ) : (
                label && <p className="alert-why">{label.why}</p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
