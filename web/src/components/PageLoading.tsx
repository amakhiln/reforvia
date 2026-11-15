import Link from "next/link";
import { Spinner } from "./AppShell";

/** Instant shell shown while a route's client view loads, so a tap never feels dead.
 *  Plain markup on purpose: AppShell reads the pathname, which isn't allowed in a Suspense fallback. */
export function PageLoading({ title, backHref }: { title: string; backHref?: string; hideNav?: boolean }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/90 px-5 pb-3 pt-[max(env(safe-area-inset-top),1rem)]">
        {backHref && (
          <Link href={backHref} className="-ml-1 mb-1 inline-flex items-center gap-1 py-1 text-sm font-medium text-accent">
            Back
          </Link>
        )}
        <h1 className="truncate text-2xl font-semibold uppercase tracking-wide">{title}</h1>
      </header>
      <main className="flex-1 px-5 pt-5">
        <Spinner />
      </main>
    </div>
  );
}
