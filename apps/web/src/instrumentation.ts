/**
 * Next.js server boot hook. Starts the durable ingest worker right away, so jobs that were queued
 * or interrupted before a restart continue without waiting for the first request.
 * (Also started lazily by getServerDeps(); both are idempotent.)
 */
export async function register() {
  // Compile-time constant per runtime: the edge bundle drops the Node-only import.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startServerWork } = await import("./instrumentation-node");
    startServerWork();
  }
}
