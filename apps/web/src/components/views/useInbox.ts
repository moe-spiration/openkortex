"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { addTag, moveItem, removeTag, requestPlacementReview } from "@/lib/api/actions";
import { INBOX_PROPOSALS, isLiveData } from "@/lib/workspace-data";
import { useShell } from "@/lib/shell/store";
import { EMPTY_INBOX, type InboxDecision, type InboxPersisted, type InboxProposal } from "@/lib/mock/views";
import { t } from "@/i18n";

/*
 * Triage state of the Inbox page: which proposals are accepted and what the user changed in the
 * detail panel. Proposals come from the data seam (live: processed items the Gardener placed on its
 * own in the last 14 days; mock: the prototype list). Decisions are kept in localStorage; in live
 * mode accepting writes the item (moveItem as a manual placement, addTag, removeTag), which also
 * takes it out of the next snapshot's review queue. Undo moves it back and clears the manual flag.
 */

const KEY = "kortex.inbox.v1";

function read(): InboxPersisted {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<InboxPersisted> | null;
    if (!raw) return EMPTY_INBOX;
    return {
      drafts: raw.drafts && typeof raw.drafts === "object" ? raw.drafts : {},
      accepted: raw.accepted && typeof raw.accepted === "object" ? raw.accepted : {},
      hideDone: raw.hideDone === true,
    };
  } catch {
    return EMPTY_INBOX;
  }
}

export interface ReviewItem extends InboxProposal {
  /** Target and tags as currently chosen (proposal plus the user's edits). */
  chosenTarget: string;
  chosenTags: string[];
}

/** A proposal as the Inbox page lists it: open (decision null) or accepted in this or an earlier visit. */
export interface InboxRow extends ReviewItem {
  decision: InboxDecision | null;
}

export function useInbox() {
  const { showToast } = useShell();
  const [state, setState] = useState<InboxPersisted>(EMPTY_INBOX);
  const [ready, setReady] = useState(false);
  // Snapshot of the queue for this visit (accepted items stay listed under "Erledigt" until reload).
  const [proposals] = useState<InboxProposal[]>(() => INBOX_PROPOSALS.map((p) => ({ ...p })));
  // Archived or deleted from the triage (X / Backspace) during this visit; the server keeps them out afterwards.
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    setState(read());
    setReady(true);
  }, []);

  const commit = useCallback((fn: (s: InboxPersisted) => InboxPersisted) => {
    setState((s) => {
      const next = fn(s);
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* storage blocked: decisions last for this visit */
      }
      return next;
    });
  }, []);

  const review = useMemo<ReviewItem[]>(
    () =>
      proposals.filter((p) => !state.accepted[p.id] && !hidden.has(p.id)).map((p) => {
        const d = state.drafts[p.id];
        return { ...p, chosenTarget: d?.target ?? p.target, chosenTags: d?.tags ?? p.tags };
      }),
    [state, proposals, hidden],
  );

  // Feinschliff Live: every proposal of this visit in its original order; accepted ones stay in place as "Abgelegt".
  const rows = useMemo<InboxRow[]>(
    () =>
      proposals.filter((p) => !hidden.has(p.id)).map((p) => {
        const decision = state.accepted[p.id] ?? null;
        const d = state.drafts[p.id];
        return { ...p, chosenTarget: decision?.target ?? d?.target ?? p.target, chosenTags: decision?.tags ?? d?.tags ?? p.tags, decision };
      }),
    [state, proposals, hidden],
  );

  const accepted = useMemo(
    () =>
      Object.values(state.accepted)
        .sort((a, b) => (a.acceptedAt < b.acceptedAt ? 1 : -1))
        .flatMap((d) => {
          const p = proposals.find((x) => x.id === d.id);
          return p ? [{ proposal: p, decision: d }] : [];
        }),
    [state, proposals],
  );

  /** Live mode: tell the database. Returns the first error (null when everything was written). */
  const persist = useCallback(async (p: InboxProposal, target: string, tags: string[]): Promise<string | null> => {
    if (!isLiveData() || !p.itemId) return null;
    const results: { ok: boolean; error?: string }[] = [await moveItem(p.itemId, target, { manual: true })];
    for (const tag of tags.filter((x) => !p.tags.includes(x))) results.push(await addTag(p.itemId, tag));
    for (const tag of p.tags.filter((x) => !tags.includes(x))) results.push(await removeTag(p.itemId, tag));
    const failed = results.find((r) => !r.ok);
    return failed ? (failed.error ?? t("unknown error")) : null;
  }, []);

  const setTarget = useCallback(
    (id: string, target: string) => commit((s) => ({ ...s, drafts: { ...s.drafts, [id]: { ...s.drafts[id], target } } })),
    [commit],
  );

  const setTags = useCallback(
    (id: string, tags: string[]) => commit((s) => ({ ...s, drafts: { ...s.drafts, [id]: { ...s.drafts[id], tags } } })),
    [commit],
  );

  const accept = useCallback(
    (item: ReviewItem): InboxDecision => {
      const decision: InboxDecision = { id: item.id, target: item.chosenTarget, tags: item.chosenTags, acceptedAt: new Date().toISOString() };
      commit((s) => {
        const { [item.id]: _draft, ...drafts } = s.drafts;
        void _draft;
        return { ...s, drafts, accepted: { ...s.accepted, [item.id]: decision } };
      });
      // Audit 0.6.1 W-09: a failed write takes the decision back (item returns to the queue) and says so.
      void persist(item, item.chosenTarget, item.chosenTags).then((error) => {
        if (!error) return;
        commit((s) => {
          const { [item.id]: _undone, ...acceptedRest } = s.accepted;
          void _undone;
          return { ...s, accepted: acceptedRest, drafts: { ...s.drafts, [item.id]: { target: item.chosenTarget, tags: item.chosenTags } } };
        });
        showToast(t("“{title}” could not be moved: {error}", { title: item.title, error }));
      });
      return decision;
    },
    [commit, persist, showToast],
  );

  const undo = useCallback(
    (id: string) => {
      const p = proposals.find((x) => x.id === id);
      const d = state.accepted[id];
      commit((s) => {
        const { [id]: _gone, ...accepted } = s.accepted;
        void _gone;
        return { ...s, accepted };
      });
      // Live: back to the Gardener's folder and tags, placement no longer manual (back in review).
      if (isLiveData() && p?.itemId && d) {
        void (async () => {
          const results: { ok: boolean; error?: string }[] = [
            await moveItem(p.itemId!, p.target, { manual: false }),
            // Back into the review queue even when the organizer was sure (zero-setup auto-placement).
            await requestPlacementReview(p.itemId!),
          ];
          for (const tag of d.tags.filter((x) => !p.tags.includes(x))) results.push(await removeTag(p.itemId!, tag));
          for (const tag of p.tags.filter((x) => !d.tags.includes(x))) results.push(await addTag(p.itemId!, tag));
          const failed = results.find((r) => !r.ok);
          if (failed) showToast(t("Undo not saved completely: {error}", { error: failed.error ?? t("unknown error") }));
        })();
      }
    },
    [commit, proposals, state.accepted, showToast],
  );

  /** Takes a proposal out of the queue (archive / delete) or puts it back (undo). */
  const setGone = useCallback((id: string, gone: boolean) => {
    setHidden((h) => {
      const n = new Set(h);
      if (gone) n.add(id);
      else n.delete(id);
      return n;
    });
  }, []);

  const setHideDone = useCallback((hideDone: boolean) => commit((s) => ({ ...s, hideDone })), [commit]);

  return { ready, review, rows, accepted, hideDone: state.hideDone, setTarget, setTags, accept, undo, setHideDone, setGone };
}
