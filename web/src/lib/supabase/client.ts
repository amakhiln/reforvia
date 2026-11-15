import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_KEY, SUPABASE_URL } from "./config";

let client: ReturnType<typeof createBrowserClient> | null = null;

export function getSupabase() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error("Supabase is not configured. Copy .env.example to .env.local and fill it in.");
  }
  client ??= createBrowserClient(SUPABASE_URL, SUPABASE_KEY);
  return client;
}
