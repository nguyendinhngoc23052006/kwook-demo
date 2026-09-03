/**
 * The hourly report, as text.
 *
 * Separate from anything that sends it, because the channel is the part most
 * likely to change and the least interesting. Zalo is the channel a Vietnamese
 * commercial team actually reads, and it is closed to this project: sending
 * programmatically needs a business Official Account, a funded ZBS account
 * (messages are priced per send) and templates pre-approved by Zalo, which
 * also means no free-form text. Telegram costs nothing and takes two minutes.
 * Keeping the words here and the transport in notify.ts makes that swap a new
 * adapter rather than a rewrite.
 * Verified 2026-09-03, developers.zalo.me / docs.zaloplatforms.com "ZBS
 * Template Message" (unified from ZNS on 2026-01-01).
 *
 * A dashboard is pull; this is push. Nobody opens a dashboard hourly, so the
 * report has to be readable in the notification itself - the numbers that
 * changed, the worst few findings in words, and a link for the rest.
 */

import { formatVnd } from "../lib/vnd.js";

export type ReportFinding = {
  type: string;
  severity: string;
  /** Product name where known, else the SKU. */
  subject: string;
  seller: string | null;
  oldValue: string | null;
  newValue: string | null;
  /** The model's sentence for this finding, when it wrote one. */
  explanation?: string | null;
};

export type ReportInput = {
  startedAt: Date;
  sourcesOk: number;
  sourcesAttempted: number;
  listings: number;
  findings: ReportFinding[];
  /** Recorded but survivable problems - a shop down, the model busy. */
  degraded: number;
  /**
   * Why this sweep failed outright, or null if it did not.
   *
   * Present because the worst message this bot can send is a calm one. A
   * sweep that could not read its own configuration observes nothing, finds
   * nothing, and without this would report "0 listing - no alerts this hour"
   * in the same shape as a genuinely quiet market. Silence and calm have to
   * look different, so a failure takes over the top of the message.
   */
  failure?: string | null;
  dashboardUrl?: string | null;
};

/** Vietnamese detector names. Mirrors the dashboard's own wording. */
const TITLES: Record<string, string> = {
  self_cannibalization: "tự cạnh tranh giá",
  dead_listing: "listing đứng im",
  dispersion: "giá phân tán giữa các kênh",
  floor_breach: "phá giá sàn",
  fake_anchor: "giá gạch ảo",
  attribution_loss: "mất thương hiệu",
  new_seller: "người bán mới",
};

/**
 * How many findings to spell out.
 *
 * Every sweep finds roughly the same dozen things, so a full list stops being
 * read by the second day. The severe ones carry the message; the rest are a
 * count and a link.
 */
const DETAIL_LIMIT = 4;

/** Telegram rejects a message over 4096 characters outright. */
export const MAX_MESSAGE_CHARS = 4096;

const SEVERITY_RANK: Record<string, number> = { high: 0, medium: 1, info: 2 };

function hhmm(d: Date): string {
  // The team reading this is in Vietnam; UTC would be seven hours wrong.
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
  }).format(d);
}

/**
 * Plain text on purpose - no Markdown.
 *
 * Telegram's MarkdownV2 requires escaping . - ( ) ! + = # and more, and these
 * product names are full of them: "Rong biển vụn 4.5G*3 gói", "K-WOOK (10
 * lá)". One unescaped character makes the API reject the whole message, so a
 * report would vanish for a reason that has nothing to do with prices. Plain
 * text cannot fail that way.
 */
export function buildReport(input: ReportInput): string {
  const { findings } = input;
  const high = findings.filter((f) => f.severity === "high").length;
  const failed = input.failure != null && input.failure !== "";

  const head = [
    `GIÁ SÀN · ${hhmm(input.startedAt)}`,
    `${input.sourcesOk}/${input.sourcesAttempted} nguồn · ${input.listings} listing · ` +
      `${findings.length} cảnh báo${high > 0 ? ` (${high} nghiêm trọng)` : ""}`,
  ];

  // A failed sweep says so on its second line, before any count can be read
  // as a result. The numbers stay - they are evidence of the failure, not a
  // summary of the market.
  if (failed) {
    head.push(`LƯỢT QUÉT HỎNG — ${input.failure}`);
  } else if (input.degraded > 0) {
    // Only claim the data was kept when the sweep actually kept any.
    head.push(`${input.degraded} sự cố đã ghi nhận — dữ liệu vẫn được lưu.`);
  }

  if (findings.length === 0) {
    head.push(
      "",
      failed
        ? "Không có dữ liệu giờ này — con số ở trên không phản ánh thị trường."
        : "Không có cảnh báo nào giờ này.",
    );
    return withLink(head.join("\n"), input.dashboardUrl);
  }

  const ranked = [...findings].sort(
    (a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9),
  );

  const lines: string[] = [...head, ""];
  for (const f of ranked.slice(0, DETAIL_LIMIT)) {
    lines.push(`• ${f.subject} — ${TITLES[f.type] ?? f.type}`);
    const detail = [f.seller, f.oldValue, f.newValue].filter(Boolean).join(" · ");
    if (detail) lines.push(`  ${detail}`);
    // The model's sentence when it wrote one; silence rather than filler when
    // it did not. Every number in it was formatted by code before the model
    // saw it, so nothing here is a figure the model chose.
    if (f.explanation) lines.push(`  ${f.explanation}`);
  }

  const rest = ranked.length - DETAIL_LIMIT;
  if (rest > 0) lines.push("", `và ${rest} cảnh báo khác.`);

  return withLink(lines.join("\n"), input.dashboardUrl);
}

function withLink(body: string, url: string | null | undefined): string {
  const full = url ? `${body}\n\n${url}` : body;
  if (full.length <= MAX_MESSAGE_CHARS) return full;
  // Truncating must never cut the link off, since the link is what makes a
  // truncated report still useful.
  const tail = url ? `\n…\n\n${url}` : "\n…";
  return full.slice(0, MAX_MESSAGE_CHARS - tail.length) + tail;
}

/** Money helper re-exported so callers format the same way the dashboard does. */
export { formatVnd };
