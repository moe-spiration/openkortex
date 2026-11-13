import { describe, expect, it, vi } from "vitest";
import { installEmptyJsonGuard, isEmptyJsonError } from "./json-guard";

const syntax = (input: string) => {
  try {
    JSON.parse(input);
  } catch (e) {
    return e;
  }
  throw new Error("parsed");
};

describe("W5 empty-JSON guard", () => {
  it("recognises only empty / truncated JSON bodies", () => {
    expect(isEmptyJsonError(syntax(""))).toBe(true);
    expect(isEmptyJsonError(syntax('{"a":'))).toBe(true);
    expect(isEmptyJsonError(syntax("<html>"))).toBe(false);
    expect(isEmptyJsonError(new Error("Unexpected end of JSON input"))).toBe(false);
    expect(isEmptyJsonError(null)).toBe(false);
  });

  it("marks such rejections handled and leaves others alone", () => {
    const listeners: ((e: PromiseRejectionEvent) => void)[] = [];
    const win = {
      addEventListener: (_: string, l: EventListener) => listeners.push(l as unknown as (e: PromiseRejectionEvent) => void),
      removeEventListener: vi.fn(),
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const off = installEmptyJsonGuard(win as unknown as Window);
    const ev = (reason: unknown) => ({ reason, preventDefault: vi.fn() }) as unknown as PromiseRejectionEvent;
    const empty = ev(syntax(""));
    const other = ev(new TypeError("boom"));
    listeners[0]!(empty);
    listeners[0]!(other);
    expect(empty.preventDefault).toHaveBeenCalled();
    expect(other.preventDefault).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    off();
    expect(win.removeEventListener).toHaveBeenCalled();
    warn.mockRestore();
  });
});
