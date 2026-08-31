/** Vietnamese formatting: `.` groups thousands, and prices are whole đồng. */
export function vnd(n: number | null): string {
  return n === null ? "—" : `${n.toLocaleString("vi-VN")} đ`;
}

export function pct(n: number | null): string {
  return n === null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

export function count(n: number | null): string {
  return n === null ? "—" : n.toLocaleString("vi-VN");
}

export function when(iso: string): string {
  return new Date(iso).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });
}

/** How long ago, in the coarse units a freshness column actually needs. */
export function ago(iso: string | null): string {
  if (iso === null) return "chưa bao giờ";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "vừa xong";
  if (mins < 60) return `${mins} phút trước`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} giờ trước`;
  return `${Math.floor(hours / 24)} ngày trước`;
}
