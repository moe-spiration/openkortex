import type { KortexClient } from "@kortex/db";
import { describe, expect, it } from "vitest";
import { SupabaseRemoteStore } from "../src/remote/supabase";
import type { RemoteStatus } from "../src/types";
import { sleep, USER_ID } from "./helpers";

type StatusCb = (status: string, err?: Error) => void;

/** Minimal stand-in for supabase-js Realtime: like realtime-js, removing a channel fires CLOSED. */
function fakeRealtimeClient() {
  const channels: { name: string; cb?: StatusCb; removed: boolean }[] = [];
  const client = {
    channel(name: string) {
      const entry: (typeof channels)[number] = { name, removed: false };
      channels.push(entry);
      const ch = {
        on: () => ch,
        subscribe(cb: StatusCb) {
          entry.cb = cb;
          return ch;
        },
        entry,
      };
      return ch;
    },
    async removeChannel(ch: { entry: (typeof channels)[number] }) {
      ch.entry.removed = true;
      ch.entry.cb?.("CLOSED");
      return "ok";
    },
  };
  return { client: client as unknown as KortexClient, channels };
}

describe("Realtime reconnect (SupabaseRemoteStore.subscribe)", () => {
  it("reconnects once after a drop instead of looping on its own CLOSED events", async () => {
    const { client, channels } = fakeRealtimeClient();
    const store = new SupabaseRemoteStore(client, null, USER_ID, { reconnectDelayMs: 10 });
    const statuses: RemoteStatus[] = [];
    const unsubscribe = store.subscribe({
      onChange: () => {},
      onStatus: (s) => statuses.push(s),
    });

    channels[0]?.cb?.("SUBSCRIBED");
    channels[0]?.cb?.("CHANNEL_ERROR", new Error("socket closed: 1005"));
    await sleep(40); // backoff 10 ms -> old channel removed -> new channel
    expect(channels).toHaveLength(2);
    channels[1]?.cb?.("SUBSCRIBED");

    await sleep(200); // a looping implementation would create a channel every ~10-20 ms here
    expect(channels).toHaveLength(2);
    expect(channels[0]?.removed).toBe(true);
    expect(statuses).toEqual(["connected", "disconnected", "connected"]);
    await unsubscribe();
  });

  it("keeps backing off while the server flaps (connects, then drops at once)", async () => {
    const { client, channels } = fakeRealtimeClient();
    const store = new SupabaseRemoteStore(client, null, USER_ID, {
      reconnectDelayMs: 20,
      stableConnectionMs: 10_000,
    });
    const unsubscribe = store.subscribe({ onChange: () => {} });
    const created: number[] = [];
    const t0 = Date.now();
    for (let i = 0; i < 3; i++) {
      const ch = channels[channels.length - 1];
      ch?.cb?.("SUBSCRIBED");
      ch?.cb?.("TIMED_OUT");
      const before = channels.length;
      while (channels.length === before) await sleep(5);
      created.push(Date.now() - t0);
    }
    // Delays 20, 40, 80 ms: each gap is longer than the previous one (no reset on a short connect).
    const gaps = created.map((t, i) => t - (created[i - 1] ?? 0));
    expect(gaps[2]!).toBeGreaterThan(gaps[0]! + 20);
    await unsubscribe();
  });
});
