import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Fail loudly and readably rather than rendering a blank page. The browser only
// ever gets the publishable key; every write goes through the sweep or the API.
if (!url || !key) {
  throw new Error(
    "Thiếu cấu hình Supabase: VITE_SUPABASE_URL và VITE_SUPABASE_PUBLISHABLE_KEY phải được đặt lúc build.",
  );
}

export const supabase = createClient(url, key, { auth: { persistSession: false } });
