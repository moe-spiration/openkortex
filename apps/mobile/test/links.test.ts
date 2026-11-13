import { describe, expect, it } from "vitest";
import { childFolders, folderLabel, folderTrail, linksOf, parentFolder, resolveWiki, wikiLikePattern, wikiTitles } from "../src/lib/links";

const E = (id: string, title: string, content = "", folder = "10_Notes") => ({ id, title, content, folder });

describe("wikiTitles", () => {
  it("reads plain, aliased, heading and embed links", () => {
    expect(wikiTitles("See [[Dune]], [[Jonas Weber|Jonas]], [[MCP#Tools]] and ![[Cover]]")).toEqual(["Dune", "Jonas Weber", "MCP", "Cover"]);
  });
  it("ignores empty links", () => {
    expect(wikiTitles("[[ ]] text")).toEqual([]);
  });
});

describe("resolveWiki", () => {
  const list = [E("1", "Dune"), E("2", "Jonas Weber", "", "70_Objects/People")];
  it("matches the title in any case", () => {
    expect(resolveWiki(list, "dune")?.id).toBe("1");
  });
  it("matches a vault path ending", () => {
    expect(resolveWiki(list, "People/Jonas Weber")?.id).toBe("2");
  });
  it("finds nothing for unknown targets", () => {
    expect(resolveWiki(list, "Nope")).toBeUndefined();
  });
});

describe("linksOf", () => {
  it("lists outgoing links and backlinks once each, never itself", () => {
    const a = E("a", "Alpha", "[[Beta]] and [[beta]] and [[Alpha]]");
    const b = E("b", "Beta", "back to [[Alpha]]");
    const c = E("c", "Gamma", "mentions [[alpha|A]]");
    const d = E("d", "Delta", "nothing");
    const r = linksOf(a, [a, b, c, d]);
    expect(r.out.map((x) => x.id)).toEqual(["b"]);
    expect(r.back.map((x) => x.id)).toEqual(["c"]);
  });
});

describe("wikiLikePattern", () => {
  it("escapes like wildcards", () => {
    expect(wikiLikePattern(" 100%_done ")).toBe("%[[100\\%\\_done%");
  });
});

describe("folders", () => {
  const paths = ["30_Clippings/Web", "10_Notes", "70_Objects/People", "Projekte/Kortex/Specs", "00_Inbox"];
  it("lists the root spaces, numbered first, then user folders", () => {
    expect(childFolders(paths, "").map((f) => f.label)).toEqual(["Inbox", "Notes", "Clippings", "Objects", "Projekte"]);
  });
  it("lists children, including folders implied by deeper paths", () => {
    expect(childFolders(paths, "Projekte")).toEqual([{ path: "Projekte/Kortex", label: "Kortex" }]);
    expect(childFolders(paths, "10_Notes")).toEqual([]);
  });
  it("labels, trails and parents", () => {
    expect(folderLabel("40_AI_Memories")).toBe("AI Memories");
    expect(folderTrail("70_Objects/People").map((f) => f.label)).toEqual(["Objects", "People"]);
    expect(parentFolder("70_Objects/People")).toBe("70_Objects");
    expect(parentFolder("10_Notes")).toBe("");
  });
});
