/* What a count-up or a ring has already shown in this run, by the caller's key (`seenKey`): when the screen mounts again
   (a revisit, a refresh that remounts the content) the value shows at rest instead of counting or sweeping from zero
   again, and a value that changed meanwhile moves from the one shown last (the 600 ms change). Kept in memory only;
   forgotten when the member changes. */
const shown = new Map<string, number>();
/** Entrances (Reveal ids) that have played in this run: once per launch, replayed after a member change. */
const revealed = new Set<string>();

export function seenValue(key: string | undefined): number | undefined {
  return key ? shown.get(key) : undefined;
}

export function markSeen(key: string | undefined, value: number): void {
  if (key) shown.set(key, value);
}

/** Whether the entrance with this id has already played in this run. */
export function wasRevealed(id: string): boolean {
  return revealed.has(id);
}

/** Record an entrance that actually started (on an active page). */
export function markRevealed(id: string): void {
  revealed.add(id);
}

/** Forget everything shown and every entrance played (another member signed in). */
export function forgetSeen(): void {
  shown.clear();
  revealed.clear();
}
