import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createDefaultRegistry } from "../src/adapters";
import { senderPerson, type Enrichment, type ExistingObject } from "../src/enrichment/auto-organizer";
import { ingest } from "../src/pipeline/ingest";
import { createMemoryStorageGateway } from "../src/storage";
import { ITEM_ID, mockEmbeddingModel, mockModel, staticRouter, USER_ID } from "./helpers";

// G12: the sender of a mail is matched to a `person` object by e-mail address and linked as a
// [[Wiki-Link]] (backlinks), without the model having to name the person.

const ANNA = "55555555-5555-4555-8555-000000000001";
const people: ExistingObject[] = [
  { id: ANNA, title: "Anna Muster", type: "person", emails: ["anna.muster@agentur.de"] },
  { id: "55555555-5555-4555-8555-000000000002", title: "Erik", type: "person", emails: ["erik@firma.de"] },
  { id: "55555555-5555-4555-8555-000000000003", title: "Agentur GmbH", type: "organization", emails: ["anna.muster@agentur.de"] },
];

describe("senderPerson", () => {
  it("matches the address exactly (case-insensitive) on a person only", () => {
    expect(senderPerson("Anna.Muster@Agentur.de", people)).toMatchObject({ objectId: ANNA, name: "Anna Muster" });
    expect(senderPerson("anna@agentur.de", people)).toBeNull();
    expect(senderPerson(null, people)).toBeNull();
    expect(senderPerson("keine adresse", people)).toBeNull();
  });
});

describe("mail ingest links the sender person", () => {
  const enrichment: Enrichment = {
    title: "Angebot",
    summary: "Angebot für den Workshop.",
    cluster_name: null,
    suggested_folder_path: "00_Inbox",
    tags: ["arbeit/angebote"],
    entities: [],
    action_items: [],
  };
  const run = async (existingObjects: ExistingObject[]) => {
    const models = staticRouter({ fast: mockModel(enrichment), embedding: mockEmbeddingModel() });
    const registry = createDefaultRegistry({
      storage: createMemoryStorageGateway(),
      models,
      inboundMailDomain: "in.kortex.example.com",
    });
    return ingest(
      {
        userId: USER_ID,
        fileBuffer: new Uint8Array(readFileSync(new URL("./fixtures/email/gmail-forward.eml", import.meta.url))),
        fileName: "mail.eml",
        mimeType: "message/rfc822",
        typeHint: "email",
      },
      { existingTags: [], existingClusters: [], existingObjects, folders: [{ id: "f", folder_path: "00_Inbox" }] },
      { registry, models, generateId: () => ITEM_ID, now: () => new Date("2026-11-01T09:00:00Z") },
    );
  };

  it("adds [[Anna Muster]] and the relation when the sender address is a known person", async () => {
    const res = await run(people);
    expect(res.item.content_md).toContain("- [[Anna Muster]]");
    expect(res.linkedEntities).toMatchObject([{ objectId: ANNA, objectType: "person" }]);
    expect(res.item.related_item_ids).toEqual([ANNA]);
  });

  it("stays unlinked when nobody has that address", async () => {
    const res = await run([{ id: ANNA, title: "Anna Muster", type: "person" }]);
    expect(res.item.content_md).not.toContain("[[Anna Muster]]");
    expect(res.linkedEntities).toEqual([]);
  });
});
