/* Exit-then-navigate: an exit animation ends in a navigation (or the next sheet opening) exactly once, from whichever
   comes first: the animation's end (its callback reaches done() through scheduleOnRN) or a JS fallback timer, for the
   frame budget a busy device or a hidden tab never gives back. cancel() clears the timer without calling fn (the
   component unmounted, or the exit was reversed). Plain JS: no React Native import. */
export function doneOnce(fn: () => void, fallbackMs: number): { done: () => void; cancel: () => void } {
  let fired = false;
  let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    timer = null;
    if (fired) return;
    fired = true;
    fn();
  }, Math.max(0, fallbackMs));
  const clear = () => {
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  return {
    done: () => {
      clear();
      if (fired) return;
      fired = true;
      fn();
    },
    cancel: () => {
      clear();
      fired = true;
    },
  };
}
