import { describe, expect, it } from "vitest";
import { isSupportedUpload, uploadContentType } from "../ingest/contract";

describe("uploads: no active documents (review N5 #23)", () => {
  it("refuses SVG, HTML and XML, also behind an image extension", () => {
    expect(isSupportedUpload("logo.svg", "image/svg+xml")).toBe(false);
    expect(isSupportedUpload("photo.png", "image/svg+xml")).toBe(false);
    expect(isSupportedUpload("photo.png", "text/html")).toBe(false);
    expect(isSupportedUpload("doc.pdf", "application/xhtml+xml")).toBe(false);
    expect(isSupportedUpload("logo.svg", "")).toBe(false);
    expect(isSupportedUpload("logo.svgz", "application/octet-stream")).toBe(false);
  });

  it("accepts the supported types, by type or by extension", () => {
    expect(isSupportedUpload("scan.pdf", "application/pdf")).toBe(true);
    expect(isSupportedUpload("book.epub", "application/epub+zip")).toBe(true);
    expect(isSupportedUpload("IMG_1.HEIC", "")).toBe(true);
    expect(isSupportedUpload("shot.png", "application/octet-stream")).toBe(true);
  });

  it("stores an allowlisted type only", () => {
    expect(uploadContentType("a.png", "image/png")).toBe("image/png");
    expect(uploadContentType("a.png", "application/octet-stream")).toBe("image/png");
    expect(uploadContentType("a.JPG", "")).toBe("image/jpeg");
    expect(uploadContentType("book.epub", "application/zip")).toBe("application/epub+zip");
    expect(uploadContentType("weird", "text/plain")).toBe("application/octet-stream");
  });
});
