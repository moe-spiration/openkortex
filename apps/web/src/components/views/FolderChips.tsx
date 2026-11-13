"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ContextMenu, menuFor, useContextMenu, type ActionId } from "@kortex/ui";
import { Ico } from "@/components/shell/icons";
import { vaultHref } from "@/lib/shell/routes";
import { useShell } from "@/lib/shell/store";
import { t } from "@/i18n";

export interface SubFolder {
  name: string;
  path: string;
  count: number;
}

/** Subfolders of the current vault folder, shown above its entries. Right-click: open, copy link. */
export function FolderChips({ folders }: { folders: SubFolder[] }) {
  const router = useRouter();
  const { showToast } = useShell();
  const cm = useContextMenu<string>();
  if (!folders.length) return null;

  const run = async (id: ActionId) => {
    const path = cm.menu?.target;
    if (!path) return;
    if (id === "open") router.push(vaultHref(path));
    else if (id === "copy-link") {
      try {
        await navigator.clipboard.writeText(`${window.location.origin}${vaultHref(path)}`);
        showToast(t("Link copied"));
      } catch {
        showToast(t("Link could not be copied"));
      }
    }
  };

  return (
    <nav aria-label={t("Subfolders")} className="kxh-wrap" style={{ marginTop: 16, gap: 8 }}>
      {folders.map((f) => (
        <Link key={f.path} href={vaultHref(f.path)} className="kx-btn kx-btn--secondary kx-btn--sm" {...cm.bind(f.path)}>
          <Ico name="folder" />
          {f.name}
          <span className="kx-num" style={{ fontSize: "calc(12px * var(--kx-fs, 1))", color: "var(--text-muted)" }}>
            {f.count}
          </span>
        </Link>
      ))}
      <ContextMenu at={cm.menu?.at ?? null} label={t("Folder")} sections={menuFor({ kind: "folder", split: false })} onAction={(id) => void run(id)} onClose={cm.close} />
    </nav>
  );
}
