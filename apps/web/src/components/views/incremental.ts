/* Batch arithmetic of useIncremental (pure, unit-tested). */

/** First batch and every further batch of a long list. */
export const INCREMENT = 60;

/** How many rows to render: grows by `step`, never past `total`, at least `need` (a row that must be in the DOM). */
export function nextShown(shown: number, total: number, step = INCREMENT, need = 0): number {
  return Math.min(total, Math.max(shown + step, need + 1, step));
}
