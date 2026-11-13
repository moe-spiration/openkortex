"use client";

import { t } from "@/i18n";
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { COVER_STALL_MS, coverAttemptSrc, coverRetryDelay } from "@/lib/notes/cover-retry";
import { pageIcon, searchPageIcons, type PageIcon } from "@/lib/notes/page-icons";
import { NIco } from "./icons";

/*
 * W4 (feedback round 3): the look of a page. Icon picker (monochrome Lucide icons with search, never emojis) and the
 * cover dialog (Unsplash search with preview through GET /api/covers/unsplash, or an own upload through
 * POST /api/covers/upload; without UNSPLASH_ACCESS_KEY only the upload is offered). Used by the new-note editor
 * and the note header ("Cover ändern").
 */

/** The page icon of a stored name; nothing for unknown names. */
export function PageIconGlyph({ name, size = 16, className }: { name: string | null | undefined; size?: number; className?: string }) {
  const p = pageIcon(name);
  if (!p) return null;
  return <p.Icon aria-hidden className={className} style={{ width: size, height: size }} strokeWidth={1.5} />;
}

/**
 * Cover image that survives a transient load failure or a stalled request (plan in lib/notes/cover-retry). On error,
 * or when nothing happens within COVER_STALL_MS, the element is remounted with a fresh request (cache-busting
 * parameter) a few times with a growing delay. Attempt 0 shows the stored URL unchanged.
 */
export function CoverImg({ src }: { src: string }) {
  const [attempt, setAttempt] = useState(0);
  const [prev, setPrev] = useState(src);
  if (prev !== src) {
    setPrev(src);
    setAttempt(0);
  }
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const img = useRef<HTMLImageElement | null>(null);
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const retry = () => {
    clear();
    const delay = coverRetryDelay(attempt);
    if (delay === null) return;
    timer.current = setTimeout(() => setAttempt((n) => n + 1), delay);
  };
  // Stall guard per attempt: neither load nor error within COVER_STALL_MS counts as a failure.
  useEffect(() => {
    const stall = setTimeout(() => {
      const el = img.current;
      if (el?.complete && el.naturalWidth > 0) return;
      retry();
    }, COVER_STALL_MS);
    return () => {
      clearTimeout(stall);
      clear();
    };
    // retry() reads the current attempt; the guard restarts with every attempt and source.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, src]);
  return (
    // Covers are user content of any origin; next/image adds nothing here.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={attempt}
      src={coverAttemptSrc(src, attempt)}
      alt=""
      ref={img}
      onLoad={clear}
      onError={retry}
    />
  );
}

/** Closes a popover on outside pointer-down and Escape. */
function useDismiss(ref: RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key, true);
    };
  }, [ref, onClose]);
}

export function IconPicker({ value, onPick, onClose }: { value: string | null; onPick: (name: string | null) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState("");
  const list = useMemo(() => searchPageIcons(q), [q]);
  useDismiss(ref, onClose);
  const pick = (p: PageIcon | null) => {
    onPick(p?.name ?? null);
    onClose();
  };
  return (
    <div ref={ref} className="kx-popover kx-look-pop kx-icon-pop" role="dialog" aria-label={t("Choose icon")}>
      <div className="kx-look-head">
        <input
          autoFocus
          className="kx-look-search"
          placeholder={t("Search icons, e.g. book, goal, code")}
          aria-label={t("Search icons")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && list[0]) {
              e.preventDefault();
              pick(list[0]);
            }
          }}
        />
        {value && (
          <button type="button" className="kx-btn kx-btn--ghost kx-btn--sm" onClick={() => pick(null)}>
            {t("Remove")}
          </button>
        )}
      </div>
      <div className="kx-icon-grid" role="listbox" aria-label={t("Icons")}>
        {list.map((p) => (
          <button
            key={p.name}
            type="button"
            role="option"
            aria-selected={p.name === value}
            aria-label={p.name}
            title={p.name}
            className={"kx-icon-cell" + (p.name === value ? " is-on" : "")}
            onClick={() => pick(p)}
          >
            <p.Icon aria-hidden strokeWidth={1.5} />
          </button>
        ))}
        {list.length === 0 && <p className="kx-meta kx-look-empty">{t("No icon for “{q}”.", { q })}</p>}
      </div>
    </div>
  );
}

interface Photo {
  id: string;
  thumb: string;
  url: string;
  alt: string;
  color: string | null;
  author: { name: string; link: string };
  download: string;
}

type Tab = "unsplash" | "upload";

export function CoverDialog({
  value,
  onPick,
  onClose,
  onError,
}: {
  value: string | null;
  onPick: (url: string | null) => void;
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>("unsplash");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [searched, setSearched] = useState("");
  const [preview, setPreview] = useState<Photo | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useDismiss(ref, onClose);

  // Is Unsplash configured on this server? Without the key the dialog is upload-only.
  useEffect(() => {
    const ac = new AbortController();
    fetch("/api/covers/unsplash", { signal: ac.signal, cache: "no-store" })
      .then((r) => (r.ok ? r.json().catch(() => ({ enabled: false })) : { enabled: false }))
      .then((j: { enabled?: boolean }) => {
        setEnabled(!!j.enabled);
        if (!j.enabled) setTab("upload");
      })
      .catch(() => !ac.signal.aborted && (setEnabled(false), setTab("upload")));
    return () => ac.abort();
  }, []);

  const search = async (query: string) => {
    const s = query.trim();
    if (!s) return;
    setBusy(true);
    setFailed(null);
    try {
      const r = await fetch(`/api/covers/unsplash?q=${encodeURIComponent(s)}`, { cache: "no-store" });
      const j = (await r.json().catch(() => ({}))) as { results?: Photo[]; error?: string };
      setPhotos(j.results ?? []);
      setSearched(s);
      setPreview(null);
      if (!r.ok) setFailed(j.error ?? t("Search failed"));
    } catch {
      setFailed(t("Search failed"));
    } finally {
      setBusy(false);
    }
  };

  const choose = (p: Photo) => {
    onPick(p.url);
    if (p.download) void fetch("/api/covers/unsplash/download", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ location: p.download }) }).catch(() => {});
    onClose();
  };

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/covers/upload", { method: "POST", body: fd });
      const j = (await r.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!r.ok || !j.url) throw new Error(j.error ?? t("Upload failed"));
      onPick(j.url);
      onClose();
    } catch (err) {
      onError(err instanceof Error ? err.message : t("Upload failed"));
    } finally {
      setBusy(false);
    }
  };

  const tabs: { id: Tab; label: string }[] = [
    ...(enabled ? [{ id: "unsplash" as const, label: "Unsplash" }] : []),
    { id: "upload", label: t("Upload") },
  ];

  const photoBy = t("Photo by {name} on Unsplash", { name: "\u0001" }).split("\u0001");
  let body: ReactNode;
  if (enabled === null) body = <p className="kx-meta kx-look-empty">{t("Loading…")}</p>;
  else if (tab === "unsplash" && enabled)
    body = (
      <>
        <form
          className="kx-look-head"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            void search(q);
          }}
        >
          <input autoFocus className="kx-look-search" placeholder={t("Search photos, e.g. mountains, office, coffee")} aria-label={t("Search Unsplash")} value={q} onChange={(e) => setQ(e.target.value)} />
          <button type="submit" className="kx-btn kx-btn--secondary kx-btn--sm" disabled={busy || !q.trim()}>
            {t("Search")}
          </button>
        </form>
        {preview ? (
          <div className="kx-cover-preview">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview.thumb} alt={preview.alt} style={{ background: preview.color ?? undefined }} />
            <div className="kx-cover-preview-foot">
              <span className="kx-meta">
                {photoBy[0]}
                <a href={preview.author.link} target="_blank" rel="noreferrer noopener">
                  {preview.author.name}
                </a>
                {photoBy[1]}
              </span>
              <span className="kx-grow" />
              <button type="button" className="kx-btn kx-btn--ghost kx-btn--sm" onClick={() => setPreview(null)}>
                {t("Back")}
              </button>
              <button type="button" className="kx-btn kx-btn--primary kx-btn--sm" onClick={() => choose(preview)}>
                {t("Use as cover")}
              </button>
            </div>
          </div>
        ) : (
          <div className="kx-cover-grid" role="listbox" aria-label={t("Unsplash photos")} aria-busy={busy}>
            {photos.map((p) => (
              <button key={p.id} type="button" role="option" aria-selected={false} className="kx-cover-cell" title={`${p.alt} · ${p.author.name}`} onClick={() => setPreview(p)}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.thumb} alt={p.alt} loading="lazy" style={{ background: p.color ?? undefined }} />
              </button>
            ))}
            {!busy && searched && photos.length === 0 && !failed && <p className="kx-meta kx-look-empty">{t("No photos for “{q}”.", { q: searched })}</p>}
            {!searched && !busy && <p className="kx-meta kx-look-empty">{t("Search for a subject. A click shows the preview.")}</p>}
            {failed && <p className="kx-meta kx-look-empty">{failed}</p>}
          </div>
        )}
      </>
    );
  else
    body = (
      <div
        className="kx-cover-drop"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files[0];
          if (f) void upload(f);
        }}
      >
        <NIco name="image" size={20} />
        <span>{t("Drag an image here or choose one")}</span>
        <span className="kx-meta">{t("JPG, PNG, WebP, GIF or AVIF, 8 MB at most")}</span>
        <button type="button" className="kx-btn kx-btn--secondary kx-btn--sm" disabled={busy} onClick={() => fileRef.current?.click()}>
          {busy ? t("Uploading…") : t("Choose image")}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
          aria-label={t("Upload cover image")}
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
            e.target.value = "";
          }}
        />
      </div>
    );

  return (
    <div ref={ref} className="kx-popover kx-look-pop kx-cover-pop" role="dialog" aria-label={t("Choose cover")}>
      <div className="kx-look-bar">
        <div className="kx-tabs" role="tablist" aria-label={t("Source")}>
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" className="kx-tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <span className="kx-grow" />
        {value && (
          <button
            type="button"
            className="kx-btn kx-btn--ghost kx-btn--sm"
            onClick={() => {
              onPick(null);
              onClose();
            }}
          >
            {t("Remove cover")}
          </button>
        )}
      </div>
      {body}
    </div>
  );
}
