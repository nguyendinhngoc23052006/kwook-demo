import { z } from "zod";
import { askForJson } from "./gemini.js";

/**
 * Where the model earns its place on the RESOLVER, and nowhere else.
 *
 * Everything upstream of this file is deterministic: regex parsing, exact
 * alias matching, threshold comparisons. That is deliberate — those jobs have
 * right answers, and a model would make them slower, dearer and less
 * reproducible without making them better.
 *
 * What the rules provably CANNOT do is decide whether a title a human wrote
 * on a marketplace refers to a product in the catalogue. Exact matching is
 * why "Rong biển vụn rắc cơm GÓI TO 300g, 400g" has sat unresolved: it names
 * two pack sizes, so no alias equals it and no threshold helps. That is a
 * judgment about language, and the one part of this pipeline a model is
 * actually better at than code.
 *
 * Three constraints keep it honest:
 *
 *  - It runs LAST. Only listings the deterministic resolver could not place,
 *    and that are not another brand, are ever sent. The model never overrides
 *    a certain answer and never sees most of the data.
 *  - It PROPOSES. Output lands in resolution_proposals with a confidence and
 *    a reason; a human confirms before anything is resolved. Nothing the model
 *    says changes a price, a finding, or a SKU on its own.
 *  - It is allowed to REFUSE. null with a reason is a correct answer, and for
 *    a title naming two pack sizes it is the ONLY correct answer. A model that
 *    always guesses would be worse than the exact matcher it supplements.
 */

/** The model's JSON is untrusted input like any other. Validate, never assume. */
const ProposalSet = z.object({
  proposals: z.array(
    z.object({
      title: z.string(),
      proposed_sku: z.string().nullish(),
      confidence: z.number().min(0).max(1),
      reasoning: z.string(),
    }),
  ),
});

export type Proposal = {
  title: string;
  proposed_sku: string | null;
  confidence: number;
  reasoning: string;
};

export type CatalogueEntry = {
  sku: string;
  name: string;
  netWeightG: number | null;
  packFormat: string | null;
};

const SYSTEM = `Bạn giúp đối chiếu listing trên sàn thương mại điện tử Việt Nam với danh mục sản phẩm của Kwook Việt Nam (rong biển và thực phẩm Hàn Quốc).

Với mỗi tiêu đề listing, chọn ĐÚNG MỘT sku trong danh mục, hoặc trả về null.

Quy tắc bắt buộc:
- Quy cách đóng gói là một phần của sản phẩm. Gói 300g và gói 400g là HAI sản phẩm khác nhau; lốc 3 gói và lốc 15 gói cũng vậy. Không gộp chúng.
- Nếu tiêu đề nêu HAI quy cách (ví dụ "300g, 400g") thì không có sku nào đúng: trả về null.
- Nếu tiêu đề không nêu quy cách mà danh mục có nhiều quy cách cho cùng dòng sản phẩm, trả về null.
- Không đoán. null kèm lý do tốt hơn một phỏng đoán sai — người dùng sẽ tin vào kết quả này.
- confidence phản ánh mức chắc chắn thật sự, không phải mức lịch sự.

Trả lời cho MỌI tiêu đề được đưa vào, copy nguyên văn tiêu đề vào trường title.
Lý do viết bằng tiếng Việt, một câu, nêu bằng chứng trong tiêu đề.`;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    proposals: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" },
          proposed_sku: { type: "STRING", nullable: true },
          confidence: { type: "NUMBER" },
          reasoning: { type: "STRING" },
        },
        required: ["title", "confidence", "reasoning"],
      },
    },
  },
  required: ["proposals"],
};

/**
 * Ask for a proposal per unresolved title. Returns [] when no key is set, so
 * a sweep without credentials behaves exactly as it did before this existed.
 */
export async function proposeResolutions(
  titles: string[],
  catalogue: CatalogueEntry[],
): Promise<{ proposals: Proposal[]; model: string }> {
  if (titles.length === 0) return { proposals: [], model: "" };
  if (!process.env.GEMINI_API_KEY) {
    console.log("no GEMINI_API_KEY: skipping model-assisted resolution");
    return { proposals: [], model: "" };
  }

  const catalogueText = catalogue
    .map(
      (p) =>
        `- ${p.sku}: ${p.name}${p.netWeightG ? ` (${p.netWeightG}g)` : ""}${p.packFormat ? ` [${p.packFormat}]` : ""}`,
    )
    .join("\n");

  const { data, model } = await askForJson(
    {
      system: SYSTEM,
      user: `DANH MỤC SẢN PHẨM:\n${catalogueText}\n\nCÁC TIÊU ĐỀ CHƯA KHỚP:\n${titles.map((t) => `- ${t}`).join("\n")}`,
      schema: RESPONSE_SCHEMA,
    },
    ProposalSet,
  );

  return {
    model,
    proposals: data.proposals.map((p) => ({
      title: p.title,
      proposed_sku: p.proposed_sku ?? null,
      confidence: p.confidence,
      reasoning: p.reasoning,
    })),
  };
}
