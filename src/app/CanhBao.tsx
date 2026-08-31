import { count } from "./format.js";
import type { ListingRow } from "./group.js";
import type { EventRow } from "./useDashboard.js";

/** What each detector means in the seller's own terms, not the code's. */
const LABELS: Record<string, { title: string; why: string }> = {
  self_cannibalization: {
    title: "Tự cạnh tranh giá",
    why: "Cùng một sản phẩm được bán ở nhiều mức giá khác nhau — người mua sẽ chọn mức thấp nhất.",
  },
  dead_listing: {
    title: "Listing đứng im",
    why: "Không đổi giá và không bán thêm trong 24 giờ — có thể đã hết hàng hoặc bị ẩn.",
  },
  dispersion: {
    title: "Giá phân tán giữa các kênh",
    why: "Khoảng giá giữa các nguồn rộng hơn ngưỡng cho phép.",
  },
  floor_breach: {
    title: "Phá giá sàn",
    why: "Giá bán thấp hơn mức sàn đã đặt cho sản phẩm này.",
  },
  fake_anchor: {
    title: "Giá gạch ảo",
    why: "Giá gạch cao bất thường so với giá bán — con số khuyến mãi không phản ánh giá thật.",
  },
  attribution_loss: {
    title: "Mất thương hiệu",
    why: "Listing không ghi tên thương hiệu, nên doanh số không quy về Kwook.",
  },
  new_seller: {
    title: "Người bán mới",
    why: "Một listing chưa từng thấy ở lượt quét trước.",
  },
};

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
              <div className="alert-values">
                {e.old_value} → <strong>{e.new_value}</strong>
              </div>
              {label && <p className="alert-why">{label.why}</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
