import { SUPABASE_URL } from "@/lib/supabase/config";
import type { Exercise } from "@/lib/types";

const publicUrl = (path: string) => `${SUPABASE_URL}/storage/v1/object/public/exercise-media/${path}`;

/** Images and video for a library exercise, each with its author and licence, plus the exercise's source credit. */
export function ExerciseMedia({ exercise }: { exercise: Exercise }) {
  const media = [...(exercise.exercise_media ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  const wger = exercise.source === "wger";
  if (media.length === 0 && !wger) return null;
  const credit = (author: string | null, license: string | null) => [author, license].filter(Boolean).join(" · ");
  return (
    <div className="space-y-3">
      {media.map((m) => (
        <figure key={m.id} className="overflow-hidden rounded-xl bg-bg">
          {m.kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={publicUrl(m.storage_path)} alt={`${exercise.name} demonstration`} loading="lazy" className="max-h-72 w-full object-contain" />
          ) : (
            <video src={publicUrl(m.storage_path)} controls preload="none" playsInline className="max-h-72 w-full" />
          )}
          {credit(m.author, m.license) && <figcaption className="tag px-3 py-2 text-muted">{credit(m.author, m.license)}</figcaption>}
        </figure>
      ))}
      {wger && (
        <p className="tag text-muted">
          Source:{" "}
          <a href={exercise.source_url ?? "https://wger.de"} target="_blank" rel="noopener noreferrer" className="text-accent underline">
            wger.de
          </a>
          {credit(exercise.author ?? null, exercise.license ?? null) ? ` · ${credit(exercise.author ?? null, exercise.license ?? null)}` : ""}
        </p>
      )}
    </div>
  );
}
