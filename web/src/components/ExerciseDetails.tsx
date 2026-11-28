import { ExternalIcon } from "./icons";
import { ExerciseMedia } from "./ExerciseMedia";
import type { Exercise } from "@/lib/types";

/** Everything the library knows about an exercise: guide text, media and a demo video. */
export function ExerciseDetails({ exercise: ex }: { exercise: Exercise }) {
  return (
    <div className="space-y-3 text-sm">
      <GuideRow label="Main muscles" value={ex.main_muscles} />
      <GuideRow label="Equipment" value={ex.equipment} />
      <GuideRow label="Purpose" value={ex.purpose} />
      <GuideRow label="How to" value={ex.form_instructions} />
      <GuideRow label="Avoid" value={ex.common_mistakes} />
      <GuideRow label="No equipment? Try" value={ex.alternatives} />
      <ExerciseMedia exercise={ex} />
      {ex.video_url && (
        <a href={ex.video_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 font-medium text-accent">
          Watch a demo <ExternalIcon className="size-4" />
        </a>
      )}
    </div>
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
