import type { z } from "zod";

/**
 * One hardened way to ask Gemini for JSON, shared by every model call.
 *
 * There are two of those now - resolution proposals and alert explanations -
 * and everything that made the first one survive production is generic: the
 * model names change, the newest model is the busiest, a retired model names
 * its own successor in prose. Copying that into a second file would mean the
 * next outage gets fixed in one of them.
 *
 * The free tier is the constraint that shaped all of it. This whole project
 * runs without a paid subscription, so "the newest model is at capacity" has
 * to be survivable rather than fatal.
 */

const API = "https://generativelanguage.googleapis.com/v1beta";

/** How many models to try before giving up. Enough to skip a busy newest. */
const MAX_CANDIDATES = 4;
const RETRY_DELAY_MS = 2_000;

/**
 * Two clocks, because a sweep must never be held open by a model.
 *
 * Node's fetch has NO default timeout. A server that accepts the connection
 * and then stalls holds the request until the OS gives up, which can be many
 * minutes - and this file makes up to nine requests per call (one ListModels,
 * then four candidates with a retry each), twice per sweep. That is how a
 * 3-4 minute sweep became 8 minutes and then stopped finishing at all. The
 * scraper in fetchSource.ts has had a 20s AbortController since it was
 * written; these calls quietly did not.
 *
 * REQUEST bounds one HTTP call. BUDGET bounds the whole walk, because nine
 * requests that each answer just inside the per-request limit are as bad as
 * one that hangs. The model is an assist: when the budget is spent the sweep
 * keeps its observations, its findings and its cadence, and simply goes
 * without an opinion this hour.
 */
const REQUEST_TIMEOUT_MS = 30_000;
const BUDGET_MS = 90_000;

/** Kept pure so the budget is testable without waiting for one. */
export function outOfTime(deadline: number, now = Date.now()): boolean {
  return now >= deadline;
}

/**
 * What to do about an HTTP status, kept separate so the policy is testable
 * without a network.
 *
 * 429 and 503 mean "busy, not broken" - the newest model is also the most
 * contended, and neither of these tasks is urgent enough to justify failing
 * an hour of output over a spike.
 */
export function decide(status: number): "ok" | "retry" | "next" {
  if (status >= 200 && status < 300) return "ok";
  if (status === 429 || status === 503) return "retry";
  return "next";
}

/**
 * Which model to use is DISCOVERED, not hardcoded.
 *
 * Gemini's model names change faster than this repo will, and a stale literal
 * fails at 3am inside a scheduled job with a 404 that reads like a bug. So the
 * sweep asks the API what it can actually call, and prefers a lightweight
 * model since both tasks are short. GEMINI_MODEL overrides when you want a
 * specific one.
 */
export async function listModels(apiKey: string): Promise<string[]> {
  const override = process.env.GEMINI_MODEL;
  if (override) return [override];

  const res = await fetch(`${API}/models?key=${apiKey}&pageSize=200`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
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
  return (flash.length > 0 ? flash : usable).sort(byVersionDesc);
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

/** An OpenAPI-subset schema; Gemini constrains its decoding to it. */
export type ResponseSchema = Record<string, unknown>;

export type Ask = {
  /** Persona and rules. Sent as systemInstruction, not as part of the data. */
  system: string;
  /** The data to reason over. */
  user: string;
  schema: ResponseSchema;
};

/**
 * Ask every candidate model in turn until one answers, then validate the JSON
 * it returned against `shape`.
 *
 * The model's output is untrusted input like any other: it is parsed, not
 * trusted. A response that does not fit the schema is an error, never a
 * partially-applied result.
 */
export async function askForJson<T>(
  ask: Ask,
  shape: z.ZodType<T>,
): Promise<{ data: T; model: string }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  // The clock starts before ListModels, because that call can stall too.
  const deadline = Date.now() + BUDGET_MS;

  const candidates = await listModels(apiKey);
  if (candidates.length === 0) {
    throw new Error("no Gemini model supports generateContent for this key");
  }

  const request = {
    method: "POST" as const,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: ask.system }] },
      contents: [{ role: "user", parts: [{ text: ask.user }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: ask.schema,
        temperature: 0,
      },
    }),
  };

  // Walk the candidates newest-first. The newest model is also the busiest,
  // so "high demand" on it is not a reason to give up on the whole step when
  // the previous generation is sitting there idle and equally capable.
  const queue = [...candidates.slice(0, MAX_CANDIDATES)];
  const failures: string[] = [];
  let used = "";
  let res: Response | undefined;

  // Every attempt carries its own signal: one AbortSignal cannot be reused
  // across requests, and a shared one would abort the retry the moment the
  // first attempt's clock ran out.
  const send = () =>
    fetch(`${API}/models/${used}:generateContent?key=${apiKey}`, {
      ...request,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

  while (queue.length > 0) {
    if (outOfTime(deadline)) {
      failures.push(`budget of ${BUDGET_MS}ms spent with ${queue.length} candidate(s) untried`);
      break;
    }

    const model = queue.shift();
    if (!model) break;
    used = model;

    // A timed-out request throws rather than returning a status, so it is
    // caught here and treated as this candidate failing - the same as a 500.
    // Letting it escape would abandon the remaining candidates over one slow
    // server, which is the opposite of what the walk exists for.
    let attempt: Response;
    try {
      attempt = await send();

      // 503/429 are transient by definition. One short wait costs less than
      // losing an hour of output - but not when the budget is already gone.
      if (decide(attempt.status) === "retry" && !outOfTime(deadline)) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        attempt = await send();
      }
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      failures.push(`${used}: ${why}`);
      continue;
    }

    if (attempt.ok) {
      res = attempt;
      break;
    }

    const detail = await attempt.text();
    failures.push(`${used}: HTTP ${attempt.status} ${detail.slice(0, 160)}`);

    // A retirement 404 names its replacement; that pointer beats our ordering.
    const replacement = attempt.status === 404 ? replacementFrom(detail) : null;
    if (replacement && !queue.includes(replacement)) queue.unshift(replacement);
  }

  if (!res) throw new Error(`gemini: every candidate failed - ${failures.join(" | ")}`);

  const body = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error(`gemini ${used}: response carried no text`);

  const parsed = shape.safeParse(JSON.parse(text));
  if (!parsed.success) {
    throw new Error(`gemini ${used}: response failed validation - ${parsed.error.message}`);
  }

  return { data: parsed.data, model: used };
}
