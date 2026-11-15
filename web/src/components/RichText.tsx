import { Fragment } from "react";

/** Tiny, safe renderer for the subset of Markdown the coach uses: paragraphs, "- " lists and **bold**.
 *  It never injects HTML; everything is rendered as React text nodes. */
function inline(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
      <strong key={i} className="font-semibold">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

export function RichText({ text }: { text: string }) {
  const blocks: { kind: "p" | "ul"; lines: string[] }[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      blocks.push({ kind: "p", lines: [] });
      continue;
    }
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const last = blocks[blocks.length - 1];
    if (bullet) {
      if (last?.kind === "ul") last.lines.push(bullet[1]);
      else blocks.push({ kind: "ul", lines: [bullet[1]] });
    } else if (last?.kind === "p" && last.lines.length > 0) {
      last.lines.push(line);
    } else if (last?.kind === "p" && last.lines.length === 0) {
      last.lines.push(line);
    } else {
      blocks.push({ kind: "p", lines: [line] });
    }
  }
  return (
    <div className="space-y-2 leading-relaxed">
      {blocks
        .filter((b) => b.lines.length > 0)
        .map((b, i) =>
          b.kind === "ul" ? (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {b.lines.map((l, j) => (
                <li key={j}>{inline(l)}</li>
              ))}
            </ul>
          ) : (
            <p key={i}>{b.lines.map((l, j) => (j ? [<br key={`b${j}`} />, inline(l)] : inline(l)))}</p>
          ),
        )}
    </div>
  );
}
