import { beforeEach, describe, expect, it, vi } from "vitest";

const UID = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";

type Row = { file_storage_path: string | null; file_mime_type: string | null; type: string; title: string } | null;
const state: { row: Row; session: boolean; signed: { bucket: string; key: string; seconds: number }[]; filters: [string, string][] } = {
  row: null,
  session: true,
  signed: [],
  filters: [],
};

const client = {
  from: () => {
    const q = {
      select: () => q,
      eq: (col: string, val: string) => {
        state.filters.push([col, val]);
        return q;
      },
      maybeSingle: async () => ({ data: state.row, error: null }),
    };
    return q;
  },
  storage: {
    from: (bucket: string) => ({
      createSignedUrl: async (key: string, seconds: number) => {
        state.signed.push({ bucket, key, seconds });
        return { data: { signedUrl: `https://storage.test/sign/${bucket}/${key}?token=t` }, error: null };
      },
    }),
  },
};

vi.mock("@/lib/supabase/server", () => ({
  getSession: async () => (state.session ? { client, user: { id: UID } } : null),
  ensureBootstrapped: async () => undefined,
}));

const { getReaderFileUrl } = await import("./reader-actions");

beforeEach(() => {
  state.row = null;
  state.session = true;
  state.signed = [];
  state.filters = [];
});

describe("getReaderFileUrl", () => {
  it("signs the stored PDF for one hour, scoped to the user", async () => {
    state.row = { file_storage_path: `${UID}/${ID}.pdf`, file_mime_type: "application/pdf", type: "pdf", title: "Buch" };
    const res = await getReaderFileUrl(ID);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.format).toBe("pdf");
    expect(res.data.url).toContain(`kortex-documents/${UID}/${ID}.pdf`);
    expect(Date.parse(res.data.expiresAt)).toBeGreaterThan(Date.now() + 3500_000);
    expect(state.signed).toEqual([{ bucket: "kortex-documents", key: `${UID}/${ID}.pdf`, seconds: 3600 }]);
    expect(state.filters).toContainEqual(["user_id", UID]);
    expect(state.filters).toContainEqual(["id", ID]);
  });

  it("uses a kortex-* bucket named in the path", async () => {
    state.row = { file_storage_path: `kortex-media/${UID}/b.epub`, file_mime_type: null, type: "epub", title: "B" };
    const res = await getReaderFileUrl(ID);
    expect(res.ok && res.data.format).toBe("epub");
    expect(state.signed[0]).toMatchObject({ bucket: "kortex-media", key: `${UID}/b.epub` });
  });

  it("returns errors instead of throwing", async () => {
    expect(await getReaderFileUrl("nope")).toEqual({ ok: false, error: "Ungültige ID" });
    state.session = false;
    expect((await getReaderFileUrl(ID)).ok).toBe(false);
    state.session = true;
    expect(await getReaderFileUrl(ID)).toEqual({ ok: false, error: "Eintrag nicht gefunden" });
    state.row = { file_storage_path: null, file_mime_type: null, type: "pdf", title: "x" };
    expect((await getReaderFileUrl(ID)).ok).toBe(false);
    state.row = { file_storage_path: `${UID}/x.png`, file_mime_type: "image/png", type: "image", title: "x" };
    expect((await getReaderFileUrl(ID)).ok).toBe(false);
    state.row = { file_storage_path: `someone-else/x.pdf`, file_mime_type: "application/pdf", type: "pdf", title: "x" };
    expect((await getReaderFileUrl(ID)).ok).toBe(false);
    expect(state.signed).toEqual([]);
  });
});
