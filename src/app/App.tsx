import { useState } from "react";
import { usingBuiltInConfig } from "../lib/supabaseClient.js";
import { BangGia } from "./BangGia.js";
import { CanhBao } from "./CanhBao.js";
import { ChuaKhop } from "./ChuaKhop.js";
import { DienBien } from "./DienBien.js";
import { count, when } from "./format.js";
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
  } = state.data;
  const unconfiguredSources = sources.filter((s) => (entryPointsBySource[s.id] ?? 0) === 0).length;
  const unresolved = listings.filter((l) => l.product_sku === null).length;

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
            <span>
              Lượt quét gần nhất: <strong>{when(sweep.started_at)}</strong>
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
            {sweep.finished_at === null && <span className="warn">đang chạy…</span>}
          </>
        )}
      </div>

      <nav>
        {tabs.map((t) => (
          <button key={t.id} type="button" aria-current={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
            {t.pip !== undefined && t.pip > 0 && <span className="pip">{t.pip}</span>}
          </button>
        ))}
      </nav>

      {tab === "gia" && <BangGia listings={listings} products={products} events={events} />}
      {tab === "canh-bao" && <CanhBao events={events} listings={listings} />}
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

function Masthead() {
  return (
    <header className="masthead">
      <h1>GIÁ SÀN</h1>
      <p>Theo dõi tính toàn vẹn giá kênh — Kwook Việt Nam</p>
    </header>
  );
}
