/** Tick-mark gauge: filled ticks show how far through the week's plan you are. */
export function Dial({ done, total, label }: { done: number; total: number; label: string }) {
  const ticks = 60;
  const lit = total > 0 ? Math.round((Math.min(done, total) / total) * ticks) : 0;
  return (
    <div role="img" aria-label={`${done} of ${total} ${label}`} className="relative mx-auto size-52">
      <svg viewBox="0 0 200 200" className="size-full -rotate-90">
        {Array.from({ length: ticks }, (_, i) => {
          const a = (i / ticks) * Math.PI * 2;
          const long = i % 5 === 0;
          const r1 = long ? 78 : 84;
          return (
            <line
              key={i}
              x1={100 + Math.cos(a) * r1}
              y1={100 + Math.sin(a) * r1}
              x2={100 + Math.cos(a) * 94}
              y2={100 + Math.sin(a) * 94}
              strokeWidth={long ? 3 : 2}
              strokeLinecap="round"
              className={i < lit ? "stroke-accent" : "stroke-line"}
            />
          );
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <p className="font-mono text-6xl font-semibold tabular-nums leading-none">
          {done}
          <span className="text-muted">/{total}</span>
        </p>
        <p className="tag mt-2 text-muted">{label}</p>
      </div>
    </div>
  );
}
