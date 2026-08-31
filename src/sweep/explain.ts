import { z } from "zod";
import { askForJson } from "./gemini.js";

/**
 * The second thing a model is better at than code: saying what a finding
 * MEANS to the person who has to act on it.
 *
 * The detectors are arithmetic. `dispersion` knows that KW-VUN-400 spans
 * 25,2% across two sellers; it does not know that this is a Tiki listing
 * undercutting the official store, or that the number to quote in the
 * conversation is the gap in dong. The dashboard used to bridge that with one
 * fixed sentence per detector type — accurate, identical for every finding,
 * and therefore ignorable.
 *
 * The same three constraints as the resolver apply, for the same reasons:
 *
 *  - It runs LAST, after every event is already written. A finding exists
 *    whether or not the model ever answers.
 *  - It only ever writes PROSE, into events.explanation. It cannot change a
 *    price, a severity, a threshold, or which findings fired. The worst a bad
 *    explanation can do is read badly next to numbers that are still correct.
 *  - It is allowed to REFUSE. An omitted id keeps the static sentence the
 *    dashboard has always shown, so a refusal degrades to today's behaviour
 *    rather than to a blank.
 *
 * Numbers are formatted by CODE before the model sees them and are never
 * asked for back. The model is given "159.000 đ → 135.000 đ" and asked to
 * explain it; it is not asked to compute or restate a figure, because a model
 * restating a price is a model that can get a price wrong.
 */

const ExplanationSet = z.object({
  explanations: z.array(
    z.object({
      id: z.string(),
      /** One sentence a sales manager can act on, in Vietnamese. */
      text: z.string().min(1).max(400),
    }),
  ),
});

/** One finding, already resolved to the words and numbers a human would use. */
export type FindingContext = {
  id: string;
  /** Detector name, e.g. "dispersion". */
  type: string;
  severity: string;
  /** Product name where known, else the SKU, else the listing title. */
  subject: string;
  seller: string | null;
  /** Pre-formatted by code — the model never renders a number itself. */
  oldValue: string | null;
  newValue: string | null;
};

const SYSTEM = `Bạn viết cảnh báo cho người phụ trách kênh phân phối của Kwook Việt Nam (rong biển và thực phẩm Hàn Quốc). Người đọc là quản lý bán hàng, không phải kỹ thuật.

Với mỗi phát hiện, viết ĐÚNG MỘT câu tiếng Việt nói rõ:
- chuyện gì đang xảy ra với sản phẩm hoặc người bán cụ thể đó, và
- vì sao nó đáng quan tâm về mặt kinh doanh.

Quy tắc bắt buộc:
- CHỈ dùng những con số đã được cung cấp, sao chép nguyên văn. Không tự tính, không làm tròn, không suy ra con số mới.
- Không thêm nguyên nhân mà dữ liệu không nói. Nếu không rõ vì sao giá lệch, hãy mô tả điều quan sát được chứ đừng đoán lý do.
- Không khuyên "nên giảm giá" hay "nên liên hệ người bán" — người đọc tự quyết định.
- Một câu, tối đa 40 từ, giọng trung tính.
- Nếu dữ liệu không đủ để nói điều gì có ích, BỎ QUA phát hiện đó: đừng đưa id của nó vào kết quả. Bỏ qua tốt hơn là viết một câu rỗng.

Trả về id đúng nguyên văn như đã nhận.`;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    explanations: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING" },
          text: { type: "STRING" },
        },
        required: ["id", "text"],
      },
    },
  },
  required: ["explanations"],
};

/** What each detector is measuring, so the model is not guessing from a name. */
const MEANING: Record<string, string> = {
  self_cannibalization: "cùng một sản phẩm, cùng một người bán, nhiều mức giá khác nhau",
  dispersion: "cùng một sản phẩm, các người bán khác nhau, khoảng giá rộng",
  floor_breach: "giá bán thấp hơn giá sàn đã đặt cho sản phẩm",
  fake_anchor: "giá gạch cao bất thường so với giá bán thật",
  dead_listing: "listing không bán thêm được sản phẩm nào trong khi listing anh em vẫn bán",
  new_seller: "một listing chưa từng xuất hiện ở lượt quét trước",
  attribution_loss: "listing không ghi thương hiệu nên doanh số không quy về Kwook",
};

export function describe(f: FindingContext): string {
  const parts = [
    `id: ${f.id}`,
    `loại: ${f.type} (${MEANING[f.type] ?? "không rõ"})`,
    `mức độ: ${f.severity}`,
    `đối tượng: ${f.subject}`,
  ];
  if (f.seller) parts.push(`người bán: ${f.seller}`);
  if (f.oldValue !== null || f.newValue !== null) {
    parts.push(`số liệu: ${f.oldValue ?? "—"} → ${f.newValue ?? "—"}`);
  }
  return parts.join(" | ");
}

/**
 * Explain a batch of findings. Returns an empty map when no key is set, so a
 * sweep without credentials writes events exactly as it did before this
 * existed and the dashboard falls back to its static sentences.
 */
export async function explainFindings(
  findings: FindingContext[],
): Promise<{ explanations: Map<string, string>; model: string }> {
  const empty = { explanations: new Map<string, string>(), model: "" };
  if (findings.length === 0) return empty;
  if (!process.env.GEMINI_API_KEY) {
    console.log("no GEMINI_API_KEY: leaving alerts with their static wording");
    return empty;
  }

  const { data, model } = await askForJson(
    {
      system: SYSTEM,
      user: `CÁC PHÁT HIỆN CẦN DIỄN GIẢI:\n${findings.map(describe).join("\n")}`,
      schema: RESPONSE_SCHEMA,
    },
    ExplanationSet,
  );

  // Only ids we actually asked about. A model echoing an id we never sent is
  // not a finding to annotate; dropping it silently is safer than writing
  // prose onto an unrelated row.
  const asked = new Set(findings.map((f) => f.id));
  const explanations = new Map<string, string>();
  for (const e of data.explanations) {
    if (asked.has(e.id)) explanations.set(e.id, e.text.trim());
  }

  return { explanations, model };
}
