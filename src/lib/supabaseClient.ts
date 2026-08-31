import { createClient } from "@supabase/supabase-js";

/**
 * The URL and the PUBLISHABLE key are public values. Vite inlines them into
 * the bundle, so every visitor already downloads them — committing them here
 * gives away nothing that shipping the app doesn't. What they grant is exactly
 * what RLS allows: anon SELECT on the seven tables, no write policy anywhere.
 * The SECRET key is a different thing entirely and never appears in this
 * directory; it lives only in the sweep workflow's repository secrets.
 *
 * They are defaults, not hardcoding: an environment variable still wins when
 * one is set, so pointing a build at another project stays a dashboard edit.
 * The point is that a missing or misnamed variable degrades to a working demo
 * instead of a blank page.
 */
const PUBLIC_URL = "https://mqzmsvmqhaloqzaimzqe.supabase.co";
const PUBLIC_KEY = "sb_publishable_JkeTd95euemWhroIuAXl2g_dmbe-iH3";

const url = import.meta.env.VITE_SUPABASE_URL || PUBLIC_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || PUBLIC_KEY;

/** True when this build fell back — surfaced in the UI footer, not thrown. */
export const usingBuiltInConfig =
  !import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabase = createClient(url, key, { auth: { persistSession: false } });
