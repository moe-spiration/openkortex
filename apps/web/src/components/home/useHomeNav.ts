"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import type { HomeTarget } from "@/lib/mock/home";
import { READER_HREF, readerHref, spaceHref } from "@/lib/shell/routes";
import { useShell } from "@/lib/shell/store";

/**
 * The prototype's Home callbacks (openFn / viewFn('reader') / tagFn) mapped onto the shell:
 * notes open in the half-side drawer, the reader and tag mixes are routes.
 */
export function useHomeNav() {
  const { openNote } = useShell();
  const router = useRouter();
  const go = useCallback(
    (t: HomeTarget) => {
      if (t.kind === "note") openNote(t.id);
      else router.push(t.id ? readerHref(t.id) : READER_HREF);
    },
    [openNote, router],
  );
  const pickTag = useCallback((tag: string) => router.push(spaceHref("all", tag)), [router]);
  return { go, pickTag, openNote };
}
