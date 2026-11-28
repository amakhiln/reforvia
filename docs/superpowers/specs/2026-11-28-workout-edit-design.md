# Editing a workout from the logging screen

**Why:** equipment can be busy or missing mid-session; changes must be one tap away while logging.

**Approach picked:** edit today's `workout_exercises` rows in place (web only, no migration). Rejected: delete and
re-add (loses position and targets, deletes logged sets); doing it through the Coach (changes the plan, not today).

**Design**
- A pencil button on every exercise: swap, change sets and reps (updates the plan), move up/down (today only), remove
  (confirms, warns about logged sets), and "Also change my plan" (off by default; swap and remove).
- Swap suggestions list different equipment first. An exercise with logged sets, a note or RIR is kept and marked done;
  the new one goes right after it.
- Sets and rep range after a swap: the new exercise's entry in the plan, else the replaced exercise's, else defaults.
- Weight and target reps: double progression on the new exercise's history, target kept inside today's range. With no
  history, the next set is suggested from the set just logged. Weights are never carried between exercises.
- Goal: the plan's rep ranges. No new training-goal setting.
