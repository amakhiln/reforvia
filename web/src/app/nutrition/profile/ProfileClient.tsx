"use client";

import { useEffect, useState } from "react";
import { toast } from "@yusufceng1z/ding-react";
import { AppShell, ErrorNotice, InlineSpinner, Spinner } from "@/components/AppShell";
import { getSupabase } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";

type Sex = "female" | "male";
type Goal = "lose" | "maintain" | "gain";
type Diet = "any" | "vegetarian" | "eggetarian" | "vegan";

const GOALS: { id: Goal; label: string }[] = [
  { id: "lose", label: "Lose fat" },
  { id: "maintain", label: "Maintain" },
  { id: "gain", label: "Gain muscle" },
];
const DIETS: { id: Diet; label: string }[] = [
  { id: "any", label: "No restriction" },
  { id: "vegetarian", label: "Vegetarian" },
  { id: "eggetarian", label: "Eggetarian" },
  { id: "vegan", label: "Vegan" },
];

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="group" aria-label={label} className="flex rounded-xl bg-surface-2 p-1">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          aria-pressed={value === o.id}
          className={`tag h-10 flex-1 rounded-lg ${value === o.id ? "bg-surface text-ink shadow-sm" : "text-muted"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const field = "mt-2 h-12 w-full rounded-xl border border-line bg-bg px-3.5 text-base";

export function ProfileClient() {
  const thisYear = new Date().getFullYear();
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [year, setYear] = useState("");
  const [sex, setSex] = useState<Sex>("female");
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");
  const [goal, setGoal] = useState<Goal>("maintain");
  const [diet, setDiet] = useState<Diet>("any");
  const [seeProfessional, setSeeProfessional] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    void getSupabase()
      .from("nutrition_profile")
      .select("birth_year,sex,height_cm,weight_kg,goal,diet,see_professional")
      .maybeSingle()
      .then(({ data, error }: { data: Record<string, unknown> | null; error: { message: string } | null }) => {
        if (error) setError(error.message);
        if (data) {
          setYear(String(data.birth_year));
          setSex(data.sex as Sex);
          setHeight(String(data.height_cm));
          setWeight(String(data.weight_kg));
          setGoal(data.goal as Goal);
          setDiet(data.diet as Diet);
          setSeeProfessional(Boolean(data.see_professional));
          setSaved(true);
        }
        setLoaded(true);
      });
  }, []);

  const y = Number(year);
  const h = Number(height);
  const w = Number(weight);
  const minor = year.length === 4 && y > thisYear - 18;
  const valid = y >= 1930 && y <= thisYear - 18 && h >= 120 && h <= 230 && w >= 30 && w <= 250;

  async function save() {
    if (!valid || busy) return;
    setBusy(true);
    const sb = getSupabase();
    const { data } = await sb.auth.getSession();
    const userId = data.session?.user.id;
    if (!userId) {
      setBusy(false);
      return void toast.error("You’re signed out. Please sign in again.");
    }
    const { error } = await sb.from("nutrition_profile").upsert(
      { user_id: userId, birth_year: y, sex, height_cm: h, weight_kg: w, goal, diet, see_professional: seeProfessional, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
    setBusy(false);
    if (error) return void toast.error(error.message);
    setSaved(true);
    toast.success("Profile saved");
  }

  async function remove() {
    setBusy(true);
    const { error } = await getSupabase().from("nutrition_profile").delete().not("user_id", "is", null);
    setBusy(false);
    setConfirmDelete(false);
    if (error) return void toast.error(error.message);
    setYear("");
    setHeight("");
    setWeight("");
    setSeeProfessional(false);
    setSaved(false);
    toast.info("Profile deleted");
  }

  return (
    <AppShell title="Nutrition profile" subtitle="Used to work out your targets" backHref="/nutrition">
      <p className="mb-4 rounded-xl bg-surface-2 px-3.5 py-2.5 text-xs text-muted">
        You enter this yourself and it stays private to you. The Nutrition guide uses it to estimate daily calories and protein. It is guidance for healthy adults, not medical advice. You can delete it any time.
      </p>
      {error && (
        <div className="mb-4">
          <ErrorNotice message={error} />
        </div>
      )}
      {!loaded && !error && <Spinner />}
      {loaded && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="space-y-5 rounded-2xl bg-surface p-4"
        >
          <div>
            <label htmlFor="year" className="tag text-muted">
              Year of birth
            </label>
            <input id="year" inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="e.g. 1995" className={field} />
            {minor && (
              <p role="alert" className="mt-2 text-sm text-danger">
                Targets are for adults (18 and over). Please talk to a doctor or a registered dietitian.
              </p>
            )}
          </div>
          <div>
            <span className="tag text-muted">Sex (used only in the energy equation)</span>
            <div className="mt-2">
              <Segmented
                label="Sex"
                value={sex}
                options={[
                  { id: "female", label: "Female" },
                  { id: "male", label: "Male" },
                ]}
                onChange={setSex}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="height" className="tag text-muted">
                Height (cm)
              </label>
              <input id="height" inputMode="decimal" value={height} onChange={(e) => setHeight(e.target.value.replace(/[^\d.]/g, "").slice(0, 5))} className={field} />
            </div>
            <div>
              <label htmlFor="weight" className="tag text-muted">
                Weight (kg)
              </label>
              <input id="weight" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value.replace(/[^\d.]/g, "").slice(0, 5))} className={field} />
            </div>
          </div>
          <div>
            <span className="tag text-muted">Goal</span>
            <div className="mt-2">
              <Segmented label="Goal" value={goal} options={GOALS} onChange={setGoal} />
            </div>
          </div>
          <div>
            <span className="tag text-muted">Eating pattern</span>
            <div className="mt-2 grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1">
              {DIETS.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setDiet(d.id)}
                  aria-pressed={diet === d.id}
                  className={`tag h-10 rounded-lg ${diet === d.id ? "bg-surface text-ink shadow-sm" : "text-muted"}`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-start gap-3 rounded-xl bg-surface-2 p-3.5 text-sm">
            <input type="checkbox" checked={seeProfessional} onChange={(e) => setSeeProfessional(e.target.checked)} className="mt-0.5 size-5 shrink-0 accent-[var(--accent)]" />
            <span>
              I’m pregnant or breastfeeding, have a health condition that affects what I can eat, or have a history of disordered eating.
              <span className="mt-1 block text-xs text-muted">The guide will not give targets. A doctor or a registered dietitian is the right person.</span>
            </span>
          </label>
          <button type="submit" disabled={!valid || busy} className="tag flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent text-accent-ink disabled:opacity-40">
            {busy ? <InlineSpinner /> : saved ? "Update profile" : "Save profile"}
          </button>
          {saved && (
            <div className="flex items-center justify-center gap-1">
              {confirmDelete ? (
                <>
                  <button type="button" onClick={() => void remove()} disabled={busy} className="tag rounded-lg bg-danger px-2.5 py-1.5 text-bg">
                    Delete profile
                  </button>
                  <button type="button" onClick={() => setConfirmDelete(false)} className="tag rounded-lg px-2 py-1.5 text-muted">
                    Cancel
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => setConfirmDelete(true)} className="tag rounded-lg px-2 py-1.5 text-muted">
                  Delete profile
                </button>
              )}
            </div>
          )}
        </form>
      )}
    </AppShell>
  );
}
