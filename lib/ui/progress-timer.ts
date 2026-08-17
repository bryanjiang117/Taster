export function nextStartedAt(
  previous: Record<string, number>,
  steps: Array<{ id: string; status: "running" | "done" }>,
  now: number,
): Record<string, number> {
  if (steps.length === 0) return {};

  const next = { ...previous };
  for (const step of steps) {
    if (step.status === "running") {
      if (next[step.id] == null) next[step.id] = now;
    } else {
      delete next[step.id];
    }
  }
  return next;
}
