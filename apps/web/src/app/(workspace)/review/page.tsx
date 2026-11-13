import { redirect } from "next/navigation";
import { legacyJournalRedirect } from "@/lib/shell/nav";

/* fx3: the weekly review is the week tab of the journal now. Old links and bookmarks keep working. */
export default async function ReviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) for (const x of [v ?? []].flat()) params.append(k, x);
  const q = params.toString();
  redirect(legacyJournalRedirect("/review", q)!);
}
