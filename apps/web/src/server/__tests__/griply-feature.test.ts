import { FEATURES } from "@kortex/i18n";
import { afterEach, describe, expect, it } from "vitest";
import { GET as callback } from "@/app/api/connections/griply/callback/route";
import { STAGE_LABEL, stageMeta } from "@/lib/tasks-board";
import { griplyIo } from "../griply/io";
import { createMobileHandlers } from "../mobile/handler";
import { authed, postJson, setup } from "./helpers";

/* The open-source edition turns the Griply hand-over off (product.json features.griply = false): nothing of it is visible or reachable. */
describe("Griply switched off", () => {
  // The export runs the same tests with the switch off, so every test sets it itself.
  const initial = FEATURES.griply;
  afterEach(() => {
    FEATURES.griply = initial;
  });

  it("names Griply on the board while the switch is on (private build)", () => {
    FEATURES.griply = true;
    expect(STAGE_LABEL.external).toBe("In Griply");
  });

  it("answers 404 on the mobile routes and the sign-in callback", async () => {
    FEATURES.griply = false;
    const s = setup();
    const h = createMobileHandlers(() => s.deps).griply;
    const get = await h.GET(new Request("http://localhost/api/mobile/griply?area=health:Health", authed()));
    expect(get.status).toBe(404);
    const post = await h.POST(postJson("http://localhost/api/mobile/griply", { op: "handover", id: "00000000-0000-4000-8000-000000000001" }));
    expect(post.status).toBe(404);
    expect((await callback(new Request("http://localhost/api/connections/griply/callback?code=x&state=y"))).status).toBe(404);
    expect(() => griplyIo()).toThrow(/Griply/);
  });

  it("words the board without Griply", () => {
    FEATURES.griply = false;
    expect(STAGE_LABEL.external).toBe("Überführt");
    expect(stageMeta({ suggested: 0, accepted: 1, agent: 0, external: 2, done: 0 })).toBe("0 Vorschläge, 1 übernommen, 2 überführt, 0 erledigt.");
  });
});
