import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";

type Sweep = {
  id: string;
  started_at: string;
  finished_at: string | null;
  sources_ok: number;
  sources_attempted: number;
  listings_observed: number;
};

export function App() {
  const [sweep, setSweep] = useState<Sweep | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("sweeps")
      .select("id,started_at,finished_at,sources_ok,sources_attempted,listings_observed")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else setSweep(data as Sweep | null);
        setLoading(false);
      });
  }, []);

  return (
    <main>
      <h1>GIÁ SÀN</h1>
      <p>Theo dõi giá kênh — Kwook Việt Nam</p>
      {loading && <p>Đang tải…</p>}
      {error && <p role="alert">Lỗi: {error}</p>}
      {!loading && !error && !sweep && <p>Chưa có lượt quét nào.</p>}
      {sweep && (
        <p>
          Quét lúc {new Date(sweep.started_at).toLocaleString("vi-VN")} ·{" "}
          {sweep.sources_ok}/{sweep.sources_attempted} nguồn OK ·{" "}
          {sweep.listings_observed} listing
          {!sweep.finished_at && " · đang chạy"}
        </p>
      )}
    </main>
  );
}
