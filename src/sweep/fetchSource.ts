const UA =
  "gia-san-monitor/0.1 (+https://github.com/nguyendinhngoc23052006/kwook-demo) price-integrity research";

export type FetchResult =
  | { ok: true; html: string }
  | { ok: false; error: string };

export async function fetchPage(url: string, timeoutMs = 20_000): Promise<FetchResult> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, "Accept-Language": "vi,en;q=0.8" },
        signal: ctl.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { ok: true, html: await res.text() };
    } catch (e) {
      if (attempt === 1) return { ok: false, error: String((e as Error).message ?? e) };
      await new Promise((r) => setTimeout(r, 2000));
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, error: "unreachable" };
}
