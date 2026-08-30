import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Name the variable that is actually missing. "Thiếu cấu hình" on its own
// sends you looking through both.
const missing = [
  url ? null : "VITE_SUPABASE_URL",
  key ? null : "VITE_SUPABASE_PUBLISHABLE_KEY",
].filter(Boolean);

if (missing.length > 0) {
  throw new Error(
    `Thiếu biến môi trường lúc build: ${missing.join(", ")}. ` +
      "Đặt trong Cloudflare Pages → Settings → Environment variables (cả Production và Preview).",
  );
}

export const supabase = createClient(url, key, { auth: { persistSession: false } });
