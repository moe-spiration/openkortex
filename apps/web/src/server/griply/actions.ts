"use server";

import { headers } from "next/headers";
import { t } from "@/i18n";
import type { GriplyArea } from "@/lib/griply";
import { GRIPLY_REF, matchGriplyArea } from "@/lib/griply";
import { runAction, type ActionResult } from "@/server/settings/run";
import { griplyIo } from "./io";
import {
  disconnectGriply,
  griplyOverview,
  griplyStatus,
  handOverToGriply,
  startGriplyConnect,
  type GriplyStatus,
} from "./service";

/* Server actions of the Griply connection. The session decides who the user is; the tokens are read with the service role. */

async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function getGriplyStatus(): Promise<ActionResult<GriplyStatus>> {
  return runAction("griply status", async ({ userId }) => griplyStatus(griplyIo(), userId));
}

/** Starts the sign-in; the browser then goes to `url` (Griply's page). */
export async function connectGriply(serverUrl: string): Promise<ActionResult<{ url: string | null; status: GriplyStatus }>> {
  return runAction("griply connect", async ({ userId }) => startGriplyConnect(griplyIo(), userId, serverUrl, await origin()));
}

export async function disconnectGriplyAction(): Promise<ActionResult<GriplyStatus>> {
  return runAction("griply disconnect", async ({ userId }) => disconnectGriply(griplyIo(), userId));
}

export interface GriplyAreaView {
  state: GriplyStatus["state"];
  area: GriplyArea | null;
}

/** The Griply side of one Kortex life area (matched by name), for the rail of the area's page. */
export async function getGriplyArea(key: string, labels: string[] = []): Promise<ActionResult<GriplyAreaView>> {
  return runAction("griply area", async ({ userId }) => {
    const io = griplyIo();
    const status = await griplyStatus(io, userId);
    if (status.state !== "connected") return { state: status.state, area: null };
    return { state: "connected" as const, area: matchGriplyArea(await griplyOverview(io, userId), key.slice(0, 40), labels.slice(0, 4)) ?? null };
  });
}

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/** "An Griply geben": creates the task in Griply and marks it as handed over here. */
export async function sendTaskToGriply(actionId: string): Promise<ActionResult<{ exported_at: string; external_ref: string }>> {
  return runAction("griply hand over", async ({ client, userId }) => {
    if (!isUuid(actionId)) throw new Error(t("Task not found"));
    const { data: task, error } = await client
      .from("action_items")
      .select("id,title,due_date,context,priority,external_ref")
      .eq("user_id", userId)
      .eq("id", actionId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!task) throw new Error(t("Task not found"));
    const id = await handOverToGriply(griplyIo(), userId, { id: task.id, title: task.title, due: task.due_date, context: task.context, priority: task.priority });
    const patch = { exported_at: new Date().toISOString(), external_ref: GRIPLY_REF(id) };
    const { error: saveError } = await client.from("action_items").update(patch).eq("user_id", userId).eq("id", actionId);
    if (saveError) throw new Error(saveError.message);
    return patch;
  });
}
