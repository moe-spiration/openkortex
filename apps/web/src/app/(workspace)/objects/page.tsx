import { redirect } from "next/navigation";
import { OBJECT_HUBS } from "@/lib/workspace-data";
import { objectHref } from "@/lib/shell/routes";
import { loadWorkspace } from "@/lib/supabase/workspace";

/* /objects opens the first object type (dummy: "Personen" tab). */
export default async function ObjectsPage() {
  await loadWorkspace();
  redirect(objectHref(OBJECT_HUBS.find((h) => h.type === "person")?.type ?? OBJECT_HUBS[0]?.type ?? "person"));
}
