import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

/**
 * Where the model earns its place, and nowhere else.
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
 * judgment about language, and it is the one part of this pipeline a model is
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
 *  - It is allowed to REFUSE. "null" with a reason is a correct answer, and
 *    for a title naming two pack sizes it is the ONLY correct answer. A model
 *    that always guesses would be worse than the exact matcher it supplements.
 */

const Proposal = z.object({
  title: z.string().describe("The observed listing title, copied exactly"),
  proposed_sku: z
    .string()
    .nullable()
    .describe("SKU from the catalogue, or null when no single SKU is right"),
  confidence: z.number().describe("0 to 1. Below 0.6 means a human should look"),
  reasoning: z
    .string()
    .describe("One sentence in Vietnamese explaining the decision, for the person confirming it"),
});

const ProposalSet = z.object({ proposals: z.array(Proposal) });

export type Proposal = z.infer<typeof Proposal>;

export type CatalogueEntry = {
  sku: string;
  name: string;
  netWeightG: number | null;
  packFormat: string | null;
};

/** Kept next to the call so a change to either is visible in one diff. */
export const MODEL = "claude-opus-5";

const SYSTEM = `Bạn giúp đối chiếu listing trên sàn thương mại điện tử Việt Nam với danh mục sản phẩm của Kwook Việt Nam (rong biển và thực phẩm Hàn Quốc).

Với mỗi tiêu đề listing, chọn ĐÚNG MỘT sku trong danh mục, hoặc trả về null.

Quy tắc bắt buộc:
- Quy cách đóng gói là một phần của sản phẩm. Gói 300g và gói 400g là HAI sản phẩm khác nhau, lốc 3 gói và lốc 15 gói cũng vậy. Không gộp chúng.
- Nếu tiêu đề nêu HAI quy cách (ví dụ "300g, 400g") thì không có sku nào đúng: trả về null.
- Nếu tiêu đề không nêu quy cách và danh mục có nhiều quy cách cho cùng dòng sản phẩm, trả về null.
- Không đoán. null kèm lý do tốt hơn một phỏng đoán sai — người dùng sẽ tin vào kết quả này.
- confidence phản ánh mức chắc chắn thật sự, không phải mức lịch sự.

Lý do viết bằng tiếng Việt, một câu, nêu bằng chứng trong tiêu đề.`;

/**
 * Ask for a proposal per unresolved title. Returns [] when no key is set, so
 * a sweep without credentials behaves exactly as it did before this existed.
 */
export async function proposeResolutions(
  titles: string[],
  catalogue: CatalogueEntry[],
): Promise<Proposal[]> {
  if (titles.length === 0) return [];
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("no ANTHROPIC_API_KEY: skipping model-assisted resolution");
    return [];
  }

  const client = new Anthropic();
  const catalogueText = catalogue
    .map(
      (p) =>
        `- ${p.sku}: ${p.name}${p.netWeightG ? ` (${p.netWeightG}g)` : ""}${p.packFormat ? ` [${p.packFormat}]` : ""}`,
    )
    .join("\n");

  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 8000,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `DANH MỤC SẢN PHẨM:\n${catalogueText}\n\nCÁC TIÊU ĐỀ CHƯA KHỚP:\n${titles.map((t) => `- ${t}`).join("\n")}`,
      },
    ],
    output_config: { format: zodOutputFormat(ProposalSet) },
  });

  return response.parsed_output?.proposals ?? [];
}
