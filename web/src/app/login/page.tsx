"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabase } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { toast } from "@yusufceng1z/ding-react";
import { InlineSpinner, SetupNotice } from "@/components/AppShell";
import { LogoMark } from "@/components/Logo";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    params.get("error") === "confirmation" ? "That confirmation link didn’t work. Try signing in, or request a new one." : null,
  );
  const [info, setInfo] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const sb = getSupabase();
      if (mode === "signin") {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace("/");
        router.refresh();
      } else {
        const { data, error } = await sb.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
        });
        if (error) throw error;
        if (data.session) {
          router.replace("/");
          router.refresh();
        } else {
          setInfo("Check your email to confirm your account, then sign in.");
          toast.info("Check your email to confirm your account");
          setMode("signin");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-10">
      <div className="mb-8">
        <LogoMark size={56} className="mb-5" />
        <h1 className="text-3xl font-semibold uppercase tracking-wide">Reforvia</h1>
        <p className="mt-2 text-muted">{mode === "signin" ? "Sign in to continue your training." : "Create your account."}</p>
      </div>

      {!isSupabaseConfigured && <SetupNotice />}

      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-12 w-full rounded-xl border border-line bg-surface px-4 text-base"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Password</span>
          <input
            type="password"
            required
            minLength={8}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-12 w-full rounded-xl border border-line bg-surface px-4 text-base"
          />
        </label>

        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        {info && <p role="status" className="text-sm text-accent">{info}</p>}

        <button
          type="submit"
          disabled={busy || !isSupabaseConfigured}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent text-base font-semibold text-accent-ink disabled:opacity-50"
        >
          {busy ? (
            <>
              <InlineSpinner /> Please wait…
            </>
          ) : mode === "signin" ? (
            "Sign in"
          ) : (
            "Create account"
          )}
        </button>
      </form>

      <button
        onClick={() => {
          setMode(mode === "signin" ? "signup" : "signin");
          setError(null);
        }}
        className="mt-6 text-center text-sm text-muted"
      >
        {mode === "signin" ? "New here? Create an account" : "Already have an account? Sign in"}
      </button>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
