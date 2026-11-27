import { redirect } from "next/navigation";
import { objectHref } from "@/lib/shell/routes";

/* /objects opens the first object type (dummy: "Personen" tab). Every hub exists, so no workspace load is needed. */
export default function ObjectsPage() {
  redirect(objectHref("person"));
}
