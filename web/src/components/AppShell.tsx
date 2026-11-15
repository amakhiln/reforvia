"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChartIcon, ChatIcon, ChevronIcon, ClockIcon, HomeIcon } from "./icons";

const TABS = [
  { href: "/", label: "Today", Icon: HomeIcon },
  { href: "/progress", label: "Progress", Icon: ChartIcon },
  { href: "/coach", label: "Coach", Icon: ChatIcon },
  { href: "/history", label: "History", Icon: ClockIcon },
];

export function AppShell({
  title,
  subtitle,
  action,
  backHref,
  children,
  hideNav = false,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  backHref?: string;
  children: React.ReactNode;
  hideNav?: boolean;
}) {
  const pathname = usePathname();
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/90 px-5 pb-3 pt-[max(env(safe-area-inset-top),1rem)] backdrop-blur">
        {backHref && (
          <Link href={backHref} className="-ml-1 mb-1 inline-flex items-center gap-1 py-1 text-sm font-medium text-accent">
            <ChevronIcon className="rotate-90" /> Back
          </Link>
        )}
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            {subtitle && (
              <p suppressHydrationWarning className="tag chip mb-1.5 inline-block text-muted">
                {subtitle}
              </p>
            )}
            <h1 className="truncate text-2xl font-semibold uppercase tracking-wide">{title}</h1>
          </div>
          {action}
        </div>
      </header>

      <main className={`flex-1 px-5 pt-5 ${hideNav ? "pb-40" : "pb-28"}`}>{children}</main>

      {!hideNav && (
        <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
          <div className="mx-auto flex max-w-xl">
            {TABS.map(({ href, label, Icon }) => {
              const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`tag flex flex-1 flex-col items-center gap-1 py-3 ${active ? "text-accent" : "text-muted"}`}
                >
                  <Icon />
                  {label}
                </Link>
              );
            })}
          </div>
        </nav>
      )}
    </div>
  );
}

export function SetupNotice() {
  return (
    <div className="rounded-2xl border border-line bg-surface p-5 text-sm">
      <p className="font-semibold">Supabase isn’t connected yet</p>
      <p className="mt-2 text-muted">
        Copy <code className="rounded bg-surface-2 px-1.5 py-0.5">.env.example</code> to{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5">.env.local</code>, add your project URL and publishable key,
        then restart the dev server.
      </p>
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-3 py-16 text-sm text-muted">
      <span className="size-4 animate-spin rounded-full border-2 border-line border-t-accent" />
      {label}
    </div>
  );
}

export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-2xl border border-danger/40 bg-surface p-5 text-sm">
      <p className="font-semibold text-danger">Something went wrong</p>
      <p className="mt-1 break-words text-muted">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-sm font-medium">
          Try again
        </button>
      )}
    </div>
  );
}
