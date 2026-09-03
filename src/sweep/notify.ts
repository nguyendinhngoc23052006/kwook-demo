/**
 * Push the hourly report somewhere a person will actually see it.
 *
 * The channel is deliberately behind one small function. Zalo is what a
 * Vietnamese commercial team reads, and it is not open to this project:
 * sending programmatically needs a business Official Account, a funded ZBS
 * account (each message is priced) and templates Zalo reviews before they can
 * be used - which also rules out free-form text like this report. Telegram is
 * free, needs no company registration, and takes two minutes to set up.
 * Verified 2026-09-03, developers.zalo.me and docs.zaloplatforms.com
 * ("ZBS Template Message", unified from ZNS on 2026-01-01).
 *
 * So the report is built as text elsewhere and this file only moves it. A
 * Zalo adapter later is a second `send` implementation, not a rewrite.
 */

/** Bounded like every other outbound call here; Node's fetch has no default. */
const REQUEST_TIMEOUT_MS = 15_000;

export type NotifyResult = { sent: true; channel: string } | { sent: false; reason: string };

/**
 * Telegram, or nothing at all.
 *
 * Absent credentials are a configuration state, not an error: the sweep runs
 * fine without a report, exactly as it runs fine without GEMINI_API_KEY. This
 * returns a reason rather than throwing so a missing token can never be the
 * thing that fails an hour of otherwise good data.
 */
export async function sendReport(text: string): Promise<NotifyResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return { sent: false, reason: "no Telegram credentials configured" };

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        // No parse_mode on purpose. MarkdownV2 requires escaping . - ( ) ! + =
        // and more, and these product titles are full of them - "K-WOOK (10
        // lá)", "4.5G*3 gói". One missed character makes Telegram reject the
        // whole message, so a report would vanish for a reason unrelated to
        // prices. Plain text cannot fail that way.
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      // Telegram explains itself in the body - "chat not found", "bot was
      // blocked" - and that description is the whole diagnosis, so keep it.
      const detail = await res.text().catch(() => "");
      return { sent: false, reason: `Telegram HTTP ${res.status} ${detail.slice(0, 200)}` };
    }
    return { sent: true, channel: "telegram" };
  } catch (e) {
    return { sent: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
