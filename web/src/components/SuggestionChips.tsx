import { ChevronIcon } from "@/components/icons";

/** Tappable next questions: an instrument-panel label above a short list of full-width keys.
 *  Used for the starter questions and for the follow-ups under a reply, so both read the same. */
export function SuggestionChips({
  title,
  items,
  onPick,
  disabled = false,
}: {
  title: string;
  items: string[];
  onPick: (text: string) => void;
  disabled?: boolean;
}) {
  return (
    <div role="group" aria-label={title}>
      <p className="tag mb-2 flex items-center gap-2 text-muted">
        <span className="h-px w-4 bg-accent" aria-hidden />
        {title}
      </p>
      <ul className="flex flex-col gap-2">
        {items.map((text, i) => (
          <li key={text} className="rise" style={{ animationDelay: `${i * 60}ms` }}>
            <button
              onClick={() => onPick(text)}
              disabled={disabled}
              className="group flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-left text-[15px] font-medium transition-colors hover:border-accent/60 active:border-accent active:bg-accent-soft disabled:opacity-50"
            >
              <span className="min-w-0 break-words">{text}</span>
              <ChevronIcon className="-rotate-90 shrink-0 text-accent transition-transform group-active:translate-x-0.5" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
