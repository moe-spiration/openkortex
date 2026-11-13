import { getServerDeps } from "./server/deps";

/** Node-only part of the boot hook (src/instrumentation.ts): starts the durable ingest worker. */
export function startServerWork(): void {
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  try {
    getServerDeps();
  } catch (err) {
    // Missing env (mock mode without Supabase): the first API call reports it.
    console.warn(
      "[kortex-api] ingest worker not started:",
      err instanceof Error ? err.message : err,
    );
  }
}
