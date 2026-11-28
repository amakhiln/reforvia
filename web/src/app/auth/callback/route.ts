import { NextResponse, type NextRequest } from "next/server";
import { routeClient } from "@/lib/supabase/route";

// Completes flows that return a code (Supabase's default email link). Only works in the browser that started them.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const supabase = code ? await routeClient() : null;
  if (code && supabase) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}/`);
  }
  return NextResponse.redirect(`${origin}/login?error=confirmation`);
}
