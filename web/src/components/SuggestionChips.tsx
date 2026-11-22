/** Quiet follow-up questions: small outlined chips in muted text that read as part of the chat, not as calls to action.
 *  Used for the starter questions and for the follow-ups under a reply. */
export function SuggestionChips({
  title,
  items,
  onPick,
  disabled = false,
  showTitle = false,
}: {
  title: string;
  items: string[];
  onPick: (text: string) => void;
  disabled?: boolean;
  showTitle?: boolean;
}) {
  return (
    <div role="group" aria-label={title}>
      {showTitle && <p className="tag mb-2 text-muted">{title}</p>}
      <ul className="flex flex-wrap gap-1.5">
        {items.map((text) => (
          <li key={text}>
            <button
              onClick={() => onPick(text)}
              disabled={disabled}
              className="min-h-9 rounded-lg border border-line px-3 py-1.5 text-left text-sm text-muted transition-colors hover:border-muted hover:text-ink active:bg-surface-2 active:text-ink disabled:opacity-50"
            >
              {text}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
