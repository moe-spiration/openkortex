import { describe, expect, it } from "vitest";
import type { IngestFailure } from "../src/lib/api";
import { describeFailure, failingField } from "../src/lib/errors";

const f = (code: IngestFailure["error"]["code"], message = "msg", details?: unknown): IngestFailure => ({
  ok: false,
  error: { code, message, details },
});

describe("describeFailure", () => {
  it("sends setup and auth problems to the options page", () => {
    expect(describeFailure(f("setup_required"))).toMatchObject({ action: "options", title: "Noch nicht verbunden" });
    expect(describeFailure(f("unauthorized"))).toMatchObject({ action: "options", title: "Anmeldung abgelehnt" });
  });

  it("names the offending field of an invalid request", () => {
    const view = describeFailure(f("invalid_request", "title: Too big", [{ path: ["title"], code: "too_big" }]));
    expect(view).toMatchObject({ action: "back", title: "Nicht gespeichert" });
    expect(view.message).toBe("Der Titel wird vom Server abgelehnt (title: Too big).");
    expect(describeFailure(f("invalid_request", "boom")).message).toBe("boom");
    expect(describeFailure(f("invalid_request", "x", [{ path: ["unknown_field"] }])).message).toBe("x");
  });

  it("explains transient server states", () => {
    expect(describeFailure(f("not_configured")).message).toMatch(/später erneut/);
    expect(describeFailure(f("rate_limited")).title).toBe("Zu viele Anfragen");
    expect(describeFailure(f("network", "Zeitüberschreitung")).message).toBe("Zeitüberschreitung");
    expect(describeFailure(f("server_error", "Interner Fehler"))).toMatchObject({ message: "Interner Fehler", action: "back" });
  });

  it("reads the first path segment of zod issues only when present", () => {
    expect(failingField([{ path: ["tags", 3] }])).toBe("tags");
    expect(failingField([{ path: [] }])).toBeNull();
    expect(failingField(undefined)).toBeNull();
    expect(failingField([])).toBeNull();
  });
});
