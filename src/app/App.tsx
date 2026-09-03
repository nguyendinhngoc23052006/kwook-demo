import { useState } from "react";
import { usingBuiltInConfig } from "../lib/supabaseClient.js";
import { BangGia } from "./BangGia.js";
import { CanhBao } from "./CanhBao.js";
import { ChuaKhop } from "./ChuaKhop.js";
import { DienBien } from "./DienBien.js";
import { ago, count, when } from "./format.js";
import { Nguon } from "./Nguon.js";
import "./styles.css";
import { useDashboard } from "./useDashboard.js";

type Tab = "gia" | "canh-bao" | "dien-bien" | "nguon" | "chua-khop";

export function App() {
  const [tab, setTab] = useState<Tab>("gia");
  const state = useDashboard();

  if (state.status === "loading") {
    return (
      <div className="shell">
        <Masthead />
        <p className="empty">Đang tải…</p>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="shell">
        <Masthead />
        <p className="empty" role="alert">
          Không đọc được dữ liệu: {state.message}
        </p>
      </div>
    );
  }

  const {
    sweep,
    sweepHistory,
    history,
    listings,
    products,
    events,
    sources,
    urlsBySource,
    entryPointsBySource,
    proposals,
    rules,
  } = state.data;
  const unconfiguredSources = sources.filter((s) => (entryPointsBySource[s.id] ?? 0) === 0).length;
  // The same predicate Chưa khớp itself uses. An out-of-scope listing is a
  // decision already taken (it is another brand), not a listing awaiting one,
  // so counting it here made the badge read 15 while the tab listed 12.
  const unresolved = listings.filter((l) => l.product_sku === null && !l.out_of_scope).length;
  // Distinct products carrying a real finding. `info` is excluded because a
  // new listing appearing is news, not a pricing problem, and counting it
  // here would make a healthy catalogue look damaged.
  const affectedSkus = new Set(
    events.filter((e) => e.product_sku !== null && e.severity !== "info").map((e) => e.product_sku),
  ).size;

  const tabs: { id: Tab; label: string; pip?: number }[] = [
    { id: "gia", label: "Bảng giá" },
    { id: "canh-bao", label: "Cảnh báo", pip: events.length },
    { id: "dien-bien", label: "Diễn biến" },
    {
      id: "nguon",
      label: "Nguồn",
      pip: sources.filter((s) => !s.active).length + unconfiguredSources,
    },
    { id: "chua-khop", label: "Chưa khớp", pip: unresolved },
  ];

  return (
    <div className="shell">
      <Masthead />

      <div className="sweepbar">
        {sweep === null ? (
          <span>Chưa có lượt quét nào — lượt đầu tiên sẽ chạy vào đầu giờ kế tiếp.</span>
        ) : (
          <>
            {/* Absolute time alone cannot be read at a glance: "14:00" looks
                identical whether it is ten minutes or six hours old. The
                chain has measured gaps of up to 4h32m, so staleness is a real
                state this screen has to be able to admit to. */}
            <span>
              Lượt quét gần nhất: <strong>{when(sweep.started_at)}</strong>{" "}
              <span className={staleHours(sweep.started_at) >= 2 ? "warn" : "muted"}>
                ({ago(sweep.started_at)})
              </span>
            </span>
            <span>
              <strong>
                {sweep.sources_ok}/{sweep.sources_attempted}
              </strong>{" "}
              nguồn OK
              {unconfiguredSources > 0 && (
                <span className="muted"> · {unconfiguredSources} chưa cấu hình</span>
              )}
            </span>
            <span>
              <strong>{count(sweep.listings_observed)}</strong> listing
            </span>
            {/* The count of findings answers "is it working"; this answers
                "does it matter". Seven alerts could be seven problems on one
                product or one problem on seven, and only the second is a
                catalogue-wide issue. Same events, already loaded. */}
            <span>
              <strong className={affectedSkus > 0 ? "bad" : "ok"}>
                {affectedSkus}/{products.length}
              </strong>{" "}
              sản phẩm có vấn đề giá
            </span>
            {sweep.finished_at === null && <span className="warn">đang chạy…</span>}
          </>
        )}
      </div>

      {staleHours(sweep?.started_at ?? null) >= 2 && (
        <p className="stalebar" role="status">
          Dữ liệu chưa được làm mới trong {ago(sweep?.started_at ?? null)}. Giá hiển thị bên dưới là
          của lượt quét đó, không phải giá lúc này.
        </p>
      )}

      <nav>
        {tabs.map((t) => (
          <button key={t.id} type="button" aria-current={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
            {t.pip !== undefined && t.pip > 0 && <span className="pip">{t.pip}</span>}
          </button>
        ))}
      </nav>

      {tab === "gia" && <BangGia listings={listings} products={products} events={events} />}
      {tab === "canh-bao" && <CanhBao events={events} listings={listings} rules={rules} />}
      {tab === "dien-bien" && <DienBien sweepHistory={sweepHistory} history={history} />}
      {tab === "nguon" && (
        <Nguon
          sources={sources}
          urlsBySource={urlsBySource}
          entryPointsBySource={entryPointsBySource}
        />
      )}
      {tab === "chua-khop" && <ChuaKhop listings={listings} proposals={proposals} />}

      <footer>
        Quét mỗi giờ bằng GitHub Actions · dữ liệu đọc trực tiếp từ Supabase
        {usingBuiltInConfig && " · dùng cấu hình mặc định trong bundle"}
      </footer>
    </div>
  );
}

/** Hours since a timestamp; -1 when there is none, so it never reads stale. */
function staleHours(iso: string | null): number {
  if (iso === null) return -1;
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
}

function Masthead() {
  return (
    <header className="masthead">
      <h1>GIÁ SÀN</h1>
      <p>Theo dõi tính toàn vẹn giá kênh — Kwook Việt Nam</p>
    </header>
  );
}
