import { notFound } from "next/navigation";
import { ReaderView } from "@/components/reader/ReaderView";
import { liveReaderDoc } from "@/components/reader/liveDoc";
import { readerDoc, readerDocIds } from "@/components/reader/mockDoc";
import { initialKnowledgeItems, isLiveData, type KnowledgeItem } from "@/lib/workspace-data";
import { loadWorkspace } from "@/lib/supabase/workspace";

/** Only the mock document is prerendered; live items render on demand. */
export function generateStaticParams() {
  return readerDocIds().map((id) => ({ id }));
}

/** The item if it opens in the reader: the mock document, or (live) a stored pdf/epub. */
function readerItem(id: string): KnowledgeItem | undefined {
  const item = initialKnowledgeItems().find((i) => i.id === id);
  if (!item?.reader) return undefined;
  if (readerDoc(id)) return item;
  return isLiveData() && liveReaderDoc(item) ? item : undefined;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  await loadWorkspace();
  const { id } = await params;
  const mock = readerDoc(id);
  const item = mock ? undefined : readerItem(id);
  const name = mock?.fileName.pdf ?? item?.source?.fileName ?? item?.title ?? "Reader";
  return { title: name };
}

/*
 * Split-screen reader for pdf/epub items: the document left, the linked note right. The server
 * snapshot only decides notFound; the reader itself builds its document on the client.
 */
export default async function ReaderPage({ params }: { params: Promise<{ id: string }> }) {
  await loadWorkspace();
  const { id } = await params;
  if (!readerItem(id)) notFound();
  return (
    <div style={{ height: "100%" }}>
      <ReaderView id={id} />
    </div>
  );
}
