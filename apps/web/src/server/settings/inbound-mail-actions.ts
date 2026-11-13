"use server";

import {
  disableInboundMail,
  readInboundMail,
  rotateInboundMail,
  type InboundMailInfo,
} from "@/server/ingest/mail/settings";
import { runAction, type ActionResult } from "./run";

/* Server actions of Settings → Connectors → "Mail an Kortex". They run as the signed-in user (RLS). */

export async function getInboundMail(): Promise<ActionResult<InboundMailInfo>> {
  return runAction("inbound mail read", ({ client, userId }) => readInboundMail(client, userId, process.env));
}

/** Creates the address, or replaces it (the old one stops working at once). */
export async function rotateInboundMailAddress(): Promise<ActionResult<InboundMailInfo>> {
  return runAction("inbound mail rotate", ({ client, userId }) => rotateInboundMail(client, userId, process.env));
}

export async function disableInboundMailAddress(): Promise<ActionResult<InboundMailInfo>> {
  return runAction("inbound mail off", ({ client, userId }) => disableInboundMail(client, userId, process.env));
}
