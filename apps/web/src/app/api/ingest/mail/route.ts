import { getServerDeps } from "@/server/deps";
import { createMailHandlers } from "@/server/ingest/mail/handler";

// POST /api/ingest/mail — Resend inbound webhook (Mail an Kortex), Svix-signed.
// GET — the signed-in user's private inbound address. See src/server/ingest/mail and docs/mail-to-kortex.md.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const handlers = createMailHandlers(getServerDeps);
export const POST = handlers.POST;
export const GET = handlers.GET;
export const OPTIONS = handlers.OPTIONS;
