import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const live = vi.hoisted(() => ({ on: false }));
const actions = vi.hoisted(() => ({
  loadDailyCheckin: vi.fn(),
  saveDailyCheckin: vi.fn<(arg: unknown) => Promise<{ ok: true; data: { id: string } }>>(
    async () => ({ ok: true as const, data: { id: "x" } }),
  ),
}));

vi.mock("@/lib/api/actions", () => actions);
// Reads go through GET /api/read/checkin (lib/api/read.ts); routed to the same mock here.
vi.mock("@/lib/api/read", () => ({
  readApi: (_name: string, p: { date: string }) => actions.loadDailyCheckin(p.date),
  isAbort: () => false,
}));
vi.mock("@/lib/workspace-data", () => ({
  isLiveData: () => live.on,
  dailyStreakNow: () => 3,
  TASKS: [
    { id: "t1", title: "Später", done: false, due: "", priority: "low" },
    { id: "t2", title: "Dringend heute", done: false, due: "2026-10-23", priority: "urgent" },
    { id: "t3", title: "Erledigt", done: true, due: "2026-10-23", priority: "urgent" },
  ],
}));

const {
  appendMindDump,
  checkinFacts,
  changedFields,
  fetchCheckin,
  persistCheckin,
  pickEnergy,
  seedCheckin,
  storedCheckin,
  toDailyMarkdown,
} = await import("./daily");

const DAY = "2026-10-23";

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
  });
  live.on = false;
  actions.loadDailyCheckin.mockReset();
  actions.saveDailyCheckin.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("daily check-in persistence", () => {
  it("mock mode: seeds the prototype defaults and only writes localStorage", async () => {
    const c = await fetchCheckin(DAY);
    expect(c.energy).toBe(9);
    expect(actions.loadDailyCheckin).not.toHaveBeenCalled();
    persistCheckin({ ...c, energy: 4 });
    expect((await fetchCheckin(DAY)).energy).toBe(4);
    expect(actions.saveDailyCheckin).not.toHaveBeenCalled();
  });

  it("live mode: loads metadata.checkin of the daily note", async () => {
    live.on = true;
    actions.loadDailyCheckin.mockResolvedValue({
      ok: true,
      data: { ...seedCheckin(DAY, true), energy: 6 },
    });
    const c = await fetchCheckin(DAY);
    expect(actions.loadDailyCheckin).toHaveBeenCalledWith(DAY);
    expect(c.energy).toBe(6);
  });

  it("W6/A-08: a stored streak never wins over the shared value (no '0' next to '1 Tag in Folge')", async () => {
    live.on = true;
    // Stored before the day's note existed: streak 0. The shared value (dailyStreakNow) is 3.
    actions.loadDailyCheckin.mockResolvedValue({
      ok: true,
      data: { ...seedCheckin(DAY, true), streak: 0, energy: 6 },
    });
    const c = await fetchCheckin(DAY);
    expect(c.energy).toBe(6);
    expect(c.streak).toBe(3);
    // Same for the local copy (offline).
    actions.loadDailyCheckin.mockResolvedValue({ ok: false, error: "offline" });
    window.localStorage.setItem("kortex.daily.v1:" + DAY, JSON.stringify({ ...c, streak: 99 }));
    expect((await fetchCheckin(DAY)).streak).toBe(3);
  });

  it("live mode: starts empty for a new day and falls back to the local copy when the action fails", async () => {
    live.on = true;
    actions.loadDailyCheckin.mockResolvedValue({ ok: true, data: null });
    const fresh = await fetchCheckin(DAY);
    expect(fresh.energy).toBeNull();
    expect(fresh.habits).toEqual([]);

    vi.useFakeTimers();
    persistCheckin({ ...fresh, energy: 8 });
    actions.loadDailyCheckin.mockResolvedValue({ ok: false, error: "offline" });
    expect((await fetchCheckin(DAY)).energy).toBe(8);
  });

  it("live mode: saves debounced with the Markdown body and the structured check-in", async () => {
    live.on = true;
    vi.useFakeTimers();
    const c = seedCheckin(DAY, true);
    persistCheckin({ ...c, energy: 3 });
    persistCheckin({ ...c, energy: 7 });
    expect(actions.saveDailyCheckin).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(700);
    expect(actions.saveDailyCheckin).toHaveBeenCalledTimes(1);
    const arg = (
      actions.saveDailyCheckin.mock.calls[0] as unknown as [
        { date: string; markdown: string; checkin: { energy: number } },
      ]
    )[0];
    expect(arg.date).toBe(DAY);
    expect(arg.checkin.energy).toBe(7);
    expect(arg.markdown).toContain("energy: 7");
    expect(arg.markdown).toBe(toDailyMarkdown({ ...c, energy: 7 }));
  });

  it("live seed: top 3 from open tasks (due first, then priority), streak from the daily notes", () => {
    live.on = true;
    const c = seedCheckin(DAY, true);
    expect(c.focus.map((f) => f.text)).toEqual(["Dringend heute", "Später"]);
    expect(c.focus.every((f) => !f.done)).toBe(true);
    expect(c.streak).toBe(3);
    expect(c.energy).toBeNull();
  });

  it("N5 #10: an energy tap on Home and a Mind Dump from the Orbit-Bar do not overwrite each other", async () => {
    live.on = true;
    vi.useFakeTimers();
    // The note as the server has it; both widgets loaded it before either change.
    let remote = { ...seedCheckin(DAY, true), energy: null as number | null };
    actions.loadDailyCheckin.mockImplementation(async () => ({
      ok: true,
      data: structuredClone(remote),
    }));
    actions.saveDailyCheckin.mockImplementation(async (arg) => {
      remote = structuredClone((arg as { checkin: typeof remote }).checkin);
      return { ok: true as const, data: { id: "x" } };
    });
    const homeState = await fetchCheckin(DAY);

    appendMindDump(DAY, "Idee aus der Orbit-Bar");
    // Home still holds the state from before the Mind Dump and changes only the energy.
    persistCheckin({ ...homeState, energy: 7 }, undefined, homeState);
    await vi.advanceTimersByTimeAsync(700);

    expect(remote.energy).toBe(7);
    expect(remote.mindDump).toEqual(["Idee aus der Orbit-Bar"]);
  });

  it("N5 #10: a save reads the note fresh, so a change made elsewhere meanwhile survives", async () => {
    live.on = true;
    vi.useFakeTimers();
    let remote = { ...seedCheckin(DAY, true), energy: 5 as number | null };
    actions.loadDailyCheckin.mockImplementation(async () => ({
      ok: true,
      data: structuredClone(remote),
    }));
    actions.saveDailyCheckin.mockImplementation(async (arg) => {
      remote = structuredClone((arg as { checkin: typeof remote }).checkin);
      return { ok: true as const, data: { id: "x" } };
    });
    const stale = await fetchCheckin(DAY);
    // Another device adds a Mind Dump line after this tab loaded the note.
    remote = { ...remote, mindDump: ["vom Handy"] };
    persistCheckin({ ...stale, energy: 9 }, undefined, stale);
    await vi.advanceTimersByTimeAsync(700);
    expect(remote.energy).toBe(9);
    expect(remote.mindDump).toEqual(["vom Handy"]);
  });

  it("N5 #10: pending saves are per date (a second day does not cancel the first)", async () => {
    live.on = true;
    vi.useFakeTimers();
    actions.loadDailyCheckin.mockResolvedValue({ ok: true, data: null });
    const other = "2026-10-24";
    persistCheckin({ ...seedCheckin(DAY, true), energy: 2 });
    persistCheckin({ ...seedCheckin(other, true), energy: 6 });
    await vi.advanceTimersByTimeAsync(700);
    const dates = actions.saveDailyCheckin.mock.calls
      .map((c) => (c as unknown as [{ date: string }])[0].date)
      .sort();
    expect(dates).toEqual([DAY, other]);
  });

  it("N5 #10: two Mind Dumps in a row keep both lines, saves of one date run in order", async () => {
    live.on = true;
    vi.useFakeTimers();
    let remote = seedCheckin(DAY, true);
    actions.loadDailyCheckin.mockImplementation(async () => ({
      ok: true,
      data: structuredClone(remote),
    }));
    actions.saveDailyCheckin.mockImplementation(async (arg) => {
      remote = structuredClone((arg as { checkin: typeof remote }).checkin);
      return { ok: true as const, data: { id: "x" } };
    });
    appendMindDump(DAY, "eins");
    await vi.advanceTimersByTimeAsync(700);
    appendMindDump(DAY, "zwei");
    await vi.advanceTimersByTimeAsync(700);
    expect(remote.mindDump).toEqual(["eins", "zwei"]);
  });

  it("changedFields lists only what differs (date never)", () => {
    const a = seedCheckin(DAY);
    expect(changedFields(a, { ...a, energy: 2 })).toEqual(["energy"]);
    expect(changedFields(a, { ...a, date: "x" })).toEqual([]);
  });
});

describe("energy picker (Tactile Craft decision 11)", () => {
  it("pickEnergy sets 1..10 and ignores anything else", () => {
    const c = { ...seedCheckin(DAY, true), energy: null };
    expect(pickEnergy(c, 7).energy).toBe(7);
    expect(pickEnergy(c, 0)).toBe(c);
    expect(pickEnergy(c, 11)).toBe(c);
    expect(pickEnergy(c, Number.NaN)).toBe(c);
    const seven = pickEnergy(c, 7);
    expect(pickEnergy(seven, 7)).toBe(seven);
  });

  it("a pick on Home saves only the energy into the daily note (Markdown + frontmatter)", async () => {
    live.on = true;
    vi.useFakeTimers();
    const before = seedCheckin(DAY, true);
    actions.loadDailyCheckin.mockResolvedValue({ ok: true, data: { ...before, mindDump: ["von woanders"] } });
    const after = pickEnergy(before, 6);
    persistCheckin(after, undefined, before);
    await vi.advanceTimersByTimeAsync(700);
    const arg = (actions.saveDailyCheckin.mock.calls[0] as unknown as [{ markdown: string; checkin: { energy: number; mindDump: string[] } }])[0];
    expect(arg.checkin.energy).toBe(6);
    expect(arg.checkin.mindDump).toEqual(["von woanders"]);
    expect(arg.markdown).toContain("energy: 6");
    expect(arg.markdown).toContain("- Energie: 6/10");
  });

  it("storedCheckin returns only what this device stored; checkinFacts maps focus (a new day tracks no habits)", () => {
    expect(storedCheckin(DAY)).toBeNull();
    const c = pickEnergy(seedCheckin(DAY), 5);
    persistCheckin(c);
    expect(storedCheckin(DAY)?.energy).toBe(5);
    const f = checkinFacts({ ...c, focus: c.focus.map((x, i) => ({ ...x, done: i < 2 })) }, 4);
    expect(f).toEqual({ date: DAY, energy: 5, habits: {}, focusDone: 2, output: 4 });
    // An old note's habit lines are kept when it is saved again.
    const old = { ...c, habits: [{ key: "mob", label: "Morning Mobility", done: true }] };
    expect(checkinFacts(old).habits).toEqual({ mob: true });
    expect(toDailyMarkdown(old)).toContain("habits:\n  mob: true");
    expect(toDailyMarkdown(c)).not.toContain("habits:");
    expect(checkinFacts({ ...c, focus: [] }).focusDone).toBeNull();
  });
});
