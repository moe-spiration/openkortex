import { describe, expect, it, vi } from "vitest";
import { acceptsDrop, takeInboxData } from "./inboxDrop";

const dt = (over: Partial<DataTransfer> = {}) => ({ files: [], types: [], getData: () => "", ...over }) as unknown as DataTransfer;

describe("inbox drop / paste", () => {
  it("accepts files, links and text, nothing else", () => {
    expect(acceptsDrop(["Files"])).toBe(true);
    expect(acceptsDrop(["text/uri-list", "text/html"])).toBe(true);
    expect(acceptsDrop(["text/plain"])).toBe(true);
    expect(acceptsDrop(["text/html"])).toBe(false);
    expect(acceptsDrop(undefined)).toBe(false);
  });

  it("hands the data to useCapture().captureData and returns the started captures", () => {
    const captureData = vi.fn(() => 2);
    const notify = vi.fn();
    const data = dt({ types: ["Files"] });
    expect(takeInboxData(data, captureData, notify)).toBe(2);
    expect(captureData).toHaveBeenCalledWith(data);
    expect(notify).not.toHaveBeenCalled();
  });

  it("tells the user when nothing could be captured, ignores a missing DataTransfer", () => {
    const captureData = vi.fn(() => 0);
    const notify = vi.fn();
    expect(takeInboxData(dt(), captureData, notify)).toBe(0);
    expect(notify).toHaveBeenCalledOnce();
    expect(takeInboxData(null, captureData, notify)).toBe(0);
    expect(captureData).toHaveBeenCalledOnce();
  });
});
