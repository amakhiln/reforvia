import { NextResponse, type NextRequest } from "next/server";
import { routeClient } from "@/lib/supabase/route";

// The link in supabase/templates/confirm-signup.html. A token hash, unlike a code, also works when the email is
// opened on another device or browser than the one used to sign up.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const supabase = token_hash && searchParams.get("type") === "email" ? await routeClient() : null;
  if (token_hash && supabase) {
    const { error } = await supabase.auth.verifyOtp({ type: "email", token_hash });
    if (!error) return NextResponse.redirect(`${origin}/`);
  }
  return NextResponse.redirect(`${origin}/login?error=confirmation`);
}
