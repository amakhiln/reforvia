import { ExternalIcon } from "./icons";
import { ExerciseMedia } from "./ExerciseMedia";
import { demoLinks } from "@/lib/demoVideo";
import type { Exercise } from "@/lib/types";

/** Everything the library knows about an exercise: guide text, media and demo videos. */
export function ExerciseDetails({ exercise: ex }: { exercise: Exercise }) {
  const { channel, search } = demoLinks(ex);
  return (
    <div className="space-y-3 text-sm">
      <GuideRow label="Main muscles" value={ex.main_muscles} />
      <GuideRow label="Equipment" value={ex.equipment} />
      <GuideRow label="Purpose" value={ex.purpose} />
      <GuideRow label="How to" value={ex.form_instructions} />
      <GuideRow label="Avoid" value={ex.common_mistakes} />
      <GuideRow label="No equipment? Try" value={ex.alternatives} />
      <ExerciseMedia exercise={ex} />
      <div className="flex flex-col items-start gap-1">
        {channel && <VideoLink href={channel} label="Videos on DEMIC" className="text-accent" />}
        <VideoLink href={search} label={channel ? "More on YouTube" : "Watch a demo on YouTube"} className={channel ? "text-muted" : "text-accent"} />
      </div>
    </div>
  );
}

function VideoLink({ href, label, className }: { href: string; label: string; className: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={`inline-flex min-h-9 items-center gap-1.5 font-medium ${className}`}>
      {label} <ExternalIcon className="size-4 shrink-0" />
    </a>
  );
}

function GuideRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div>
      <p className="tag text-muted">{label}</p>
      <p className="mt-0.5 leading-relaxed">{value}</p>
    </div>
  );
}
