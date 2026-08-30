import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const missing = [
  url ? null : "VITE_SUPABASE_URL",
  key ? null : "VITE_SUPABASE_PUBLISHABLE_KEY",
].filter(Boolean);

if (missing.length > 0) {
  // Report what the build ACTUALLY received, not just what it wanted. Vite
  // inlines import.meta.env as a literal object, so these are exactly the
  // VITE_ keys that existed at build time. A name typo or a variable set on
  // the wrong environment shows up here immediately instead of looking
  // identical to a variable that was never set at all.
  const injected = Object.keys(import.meta.env)
    .filter((k) => k.startsWith("VITE_"))
    .sort();

  throw new Error(
    `Thiếu biến môi trường lúc build: ${missing.join(", ")}. ` +
      `Bản build này nhận được: ${injected.length > 0 ? injected.join(", ") : "(không có biến VITE_ nào)"}. ` +
      "Đặt trong Cloudflare Pages → Settings → Variables and secrets (cả Production và Preview), rồi build lại.",
  );
}

export const supabase = createClient(url, key, { auth: { persistSession: false } });
