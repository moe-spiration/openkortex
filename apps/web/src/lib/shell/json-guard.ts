/*
 * W5 (feedback round 3): an empty or cut-off HTTP response that some background request parses as JSON (a library
 * call such as an auth refresh, or a fetch while the server restarts during a deploy) ends in an unhandled
 * "SyntaxError: Unexpected end of JSON input". Nothing on screen depends on it, so the app must not treat it as a
 * page error: the view stays on its normal surface. Only that one kind of rejection is caught; it is still logged
 * as a warning with its stack, everything else stays unhandled.
 */

/** A JSON syntax error from an empty or truncated body. */
export function isEmptyJsonError(reason: unknown): boolean {
  if (!(reason instanceof SyntaxError)) return false;
  return /Unexpected end of JSON input|JSON\.parse: unexpected end of data|Unexpected EOF/i.test(reason.message);
}

/** Installs the guard once per window; returns the uninstall function. */
export function installEmptyJsonGuard(win: Pick<Window, "addEventListener" | "removeEventListener"> = window): () => void {
  const onRejection = (e: PromiseRejectionEvent) => {
    if (!isEmptyJsonError(e.reason)) return;
    e.preventDefault();
    console.warn("[kortex] empty response ignored:", (e.reason as Error).stack ?? (e.reason as Error).message);
  };
  win.addEventListener("unhandledrejection", onRejection as EventListener);
  return () => win.removeEventListener("unhandledrejection", onRejection as EventListener);
}
