import { describe, expect, it } from "vitest";
import { checkRow, restartRow } from "../src/lib/updateStatus";

describe("update rows in Einstellungen", () => {
  it("shows which update runs before the first check", () => {
    expect(checkRow({ kind: "idle" }, "01a1c5af-a41d-7e80")).toEqual({ value: "Prüfen", help: "Läuft: Update 01a1c5af" });
    expect(checkRow({ kind: "idle" }, null).help).toBe("Läuft: Version aus der Installation");
  });

  it("says current with the check time, or ready with the new update id", () => {
    const at = new Date(2026, 10, 10, 9, 5);
    expect(checkRow({ kind: "current", at }, "abcdef1234").help).toBe("Läuft: Update abcdef12 · geprüft um 09:05");
    expect(checkRow({ kind: "ready", id: "1234567890" }, null)).toEqual({ value: "Bereit", help: "Update 12345678 geladen, „App neu starten“ aktiviert es" });
  });

  it("is unavailable in development and reports errors", () => {
    expect(checkRow({ kind: "off" }, null).value).toBe("Nicht verfügbar");
    expect(restartRow({ kind: "off" }).value).toBe("Nicht verfügbar");
    expect(checkRow({ kind: "error", message: "offline" }, null)).toEqual({ value: "Fehler", help: "offline" });
  });

  it("restart says it runs the loaded update once one is ready", () => {
    expect(restartRow({ kind: "ready", id: null }).value).toBe("Jetzt");
    expect(restartRow({ kind: "idle" }).value).toBe("Neu starten");
  });
});
