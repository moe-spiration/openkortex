import { objectHref, vaultHref } from "@/lib/shell/routes";

/*
 * Breadcrumb targets of the note / Peek header (feedback round 2 #6): every folder segment opens its
 * folder in the vault view; a type folder under 70_Objects opens that object hub. The last segment is
 * the note itself and has no target.
 */

export interface Crumb {
  label: string;
  href: string | null;
}

export function noteCrumbs(path: string, hubs: ReadonlyArray<{ type: string; folder: string }>): Crumb[] {
  const parts = path.split("/").filter(Boolean);
  return parts.map((label, i) => {
    if (i === parts.length - 1) return { label, href: null };
    const prefix = parts.slice(0, i + 1);
    if (prefix.length === 2 && prefix[0] === "70_Objects") {
      const hub = hubs.find((h) => h.folder === prefix[1]);
      if (hub) return { label, href: objectHref(hub.type) };
    }
    return { label, href: vaultHref(prefix.join("/")) };
  });
}
