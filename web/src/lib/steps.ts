export type Step = { id: string; label: string; done: boolean };
export type StepChip = { label: string; count: number; done: boolean };

/** One chip per kind of step, with how many times it ran, so five searches do not show five chips. Order of first use is kept. */
export function groupSteps(steps: Step[]): StepChip[] {
  const out: StepChip[] = [];
  for (const s of steps) {
    const chip = out.find((c) => c.label === s.label);
    if (chip) {
      chip.count += 1;
      chip.done = chip.done && s.done;
    } else {
      out.push({ label: s.label, count: 1, done: s.done });
    }
  }
  return out;
}
