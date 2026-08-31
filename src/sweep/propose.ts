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
 *
 * Gemini over the REST API, on the free tier: the whole project is built to
 * run without a paid subscription, and this is the last place that could have
 * quietly broken that.
 */

const API = "https://generativelanguage.googleapis.com/v1beta";

/** The model's JSON is untrusted input like any other. Validate, never assume. */
const Proposal = z.object({
  title: z.string(),
  proposed_sku: z.string().nullish(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
});
const ProposalSet = z.object({ proposals: z.array(Proposal) });

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

/**
 * Which model to use is DISCOVERED, not hardcoded.
 *
 * Gemini's model names change faster than this repo will, and a stale literal
 * fails at 3am inside a scheduled job with a 404 that reads like a bug. So the
 * sweep asks the API what it can actually call, and prefers a lightweight
 * model since the task is short classification. GEMINI_MODEL overrides when
 * you want a specific one.
 */
export async function pickModel(apiKey: string): Promise<string> {
  const override = process.env.GEMINI_MODEL;
  if (override) return override;

  const res = await fetch(`${API}/models?key=${apiKey}&pageSize=200`);
  if (!res.ok) throw new Error(`listing models failed: HTTP ${res.status}`);

  const body = (await res.json()) as {
    models?: { name?: string; supportedGenerationMethods?: string[] }[];
  };
  const usable = (body.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m) => (m.name ?? "").replace(/^models\//, ""))
    // Exclude previews and experiments: a scheduled job should not ride a
    // model that can be withdrawn without notice.
    .filter((n) => n !== "" && !n.includes("exp") && !n.includes("preview"));

  const flash = usable.filter((n) => n.includes("flash"));
  const chosen = (flash.length > 0 ? flash : usable).sort(byVersionDesc)[0];
  if (!chosen) throw new Error("no Gemini model supports generateContent for this key");
  return chosen;
}

/**
 * Newest first, compared NUMERICALLY.
 *
 * Sorting these names as strings is wrong twice over. Ascending picked
 * gemini-2.5-flash, which ListModels still advertises but which the API
 * refuses for new keys - "no longer available to new users" - so the sweep
 * 404'd on a model the catalogue said it could call. And lexical order puts
 * "10" before "2", so a string sort breaks again the moment a version
 * reaches double digits.
 */
export function byVersionDesc(a: string, b: string): number {
  const version = (n: string): [number, number] => {
    const m = /(\d+)(?:\.(\d+))?/.exec(n);
    return [Number(m?.[1] ?? 0), Number(m?.[2] ?? 0)];
  };
  const [aMajor, aMinor] = version(a);
  const [bMajor, bMinor] = version(b);
  return bMajor - aMajor || bMinor - aMinor || a.localeCompare(b);
}

/**
 * Gemini's 404 for a retired model names its replacement in prose:
 * "Please update your code to use models/gemini-3.6-flash". That is the most
 * authoritative pointer available at runtime, so one retry against it beats
 * failing the sweep and waiting for a human to read the log.
 */
export function replacementFrom(errorBody: string): string | null {
  const m = /use\s+models\/([A-Za-z0-9.\-_]+)/.exec(errorBody);
  return m?.[1] ?? null;
}

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

/** OpenAPI-subset schema; Gemini constrains decoding to it. */
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
} as const;

/**
 * Ask for a proposal per unresolved title. Returns [] when no key is set, so
 * a sweep without credentials behaves exactly as it did before this existed.
 */
export async function proposeResolutions(
  titles: string[],
  catalogue: CatalogueEntry[],
): Promise<{ proposals: Proposal[]; model: string }> {
  if (titles.length === 0) return { proposals: [], model: "" };

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.log("no GEMINI_API_KEY: skipping model-assisted resolution");
    return { proposals: [], model: "" };
  }

  const model = await pickModel(apiKey);
  const catalogueText = catalogue
    .map(
      (p) =>
        `- ${p.sku}: ${p.name}${p.netWeightG ? ` (${p.netWeightG}g)` : ""}${p.packFormat ? ` [${p.packFormat}]` : ""}`,
    )
    .join("\n");

  const request = {
    method: "POST" as const,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `DANH MỤC SẢN PHẨM:\n${catalogueText}\n\nCÁC TIÊU ĐỀ CHƯA KHỚP:\n${titles.map((t) => `- ${t}`).join("\n")}`,
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0,
      },
    }),
  };

  let used = model;
  let res = await fetch(`${API}/models/${used}:generateContent?key=${apiKey}`, request);

  if (res.status === 404) {
    const detail = await res.text();
    const replacement = replacementFrom(detail);
    if (!replacement) throw new Error(`gemini ${used}: HTTP 404 ${detail.slice(0, 300)}`);
    console.log(`gemini: ${used} is retired, retrying with ${replacement}`);
    used = replacement;
    res = await fetch(`${API}/models/${used}:generateContent?key=${apiKey}`, request);
  }

  if (!res.ok) {
    throw new Error(`gemini ${used}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  }

  const body = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error(`gemini ${used}: response carried no text`);

  const parsed = ProposalSet.safeParse(JSON.parse(text));
  if (!parsed.success) {
    throw new Error(`gemini ${used}: response failed validation - ${parsed.error.message}`);
  }

  return {
    model: used,
    proposals: parsed.data.proposals.map((p) => ({
      title: p.title,
      proposed_sku: p.proposed_sku ?? null,
      confidence: p.confidence,
      reasoning: p.reasoning,
    })),
  };
}
