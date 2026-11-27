// Popup in the Ruhe look (2026-11-27): one job, capture this page, with one Enter. Page card, capture mode
// (page/video, selection, screenshot), property rows for folder and tags (+ cover when there is a choice), note,
// Save ↵. After saving the agent shows its steps (read, summary, filing, linking); O opens the item in Kortex,
// R snoozes it (keys 1 to 4). Summary detail and Autosave live in the options (Autosave also in the ⋯ menu).
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Ban,
  Bell,
  Bot,
  Camera,
  Check,
  ChevronDown,
  Clock,
  CloudOff,
  ExternalLink,
  FileText,
  Folder,
  Hash,
  Image as ImageIcon,
  KeyRound,
  Layers,
  LayoutGrid,
  MoreHorizontal,
  PanelRight,
  Pencil,
  Play,
  Plus,
  Settings2,
  Sparkles,
  TextSelect,
  Video,
  X,
} from "lucide-react";
import { getLocale, intlLocale, t } from "../../i18n";
import type { FileUploadFields, IngestFailure, IngestResponse } from "../../lib/api";
import type { CapturedPage } from "../../lib/captured";
import { describeFailure } from "../../lib/errors";
import { LIMITS } from "../../lib/limits";
import type { HighlightOutcome, IngestSender, RemindSender, StatusFetcher } from "../../lib/messages";
import type { SubmitResult } from "../../lib/outbox";
import type { PageMeta } from "../../lib/page-meta";
import { remindChoices } from "../../lib/remind";
import { buildWebClip, defaultClipChoice } from "../../lib/requests";
import { describePipeline, mediaLine, transcriptHint, type Pipeline } from "../../lib/result";
import type { ExtensionSettings } from "../../lib/settings";
import { detectKind, normalizeUserTag, tagOptions } from "../../lib/suggest";
import { ALT, Banner, Btn, EmptyState, FolderPath, Hints, IconBtn, LocBar, MOD, Menu, PropRow, Seg, Steps, TagDot, isTyping, modKey, type MenuItem, type Step } from "./kit";
import { AUTOSAVE_CLOSE_MS } from "../QuickSave";

export type CaptureMode = "page" | "selection" | "screenshot";

export interface PopupActions {
  send: IngestSender;
  fetchStatus?: StatusFetcher;
  remind?: RemindSender;
  /** Screenshot mode: grab the visible tab and upload it. Missing = mode shown as unavailable. */
  uploadScreenshot?: (fields: FileUploadFields) => Promise<IngestResponse>;
  /** Selection mode: the page's content script saves its selection. Missing = no content script on the page. */
  highlightSelection?: (opts: { note?: string }) => Promise<HighlightOutcome>;
  openSidePanel?: () => void;
  openManager?: () => void;
  openOptions: (section?: string) => void;
  /** Opens the item in Kortex (new tab). */
  openItem?: (itemId: string) => void;
  /** Re-opens the popup with the form (the Autosave confirmation's F). */
  openForm?: () => void;
  setAutosave?: (on: boolean) => void;
  /** "Send again now" for a queued capture. */
  flush?: () => void;
  close: () => void;
}

export interface CapturePanelProps {
  page: PageMeta;
  settings: ExtensionSettings;
  mock: boolean;
  actions: PopupActions;
  /** Already captured in this browser (duplicate banner, button "Add to it"). */
  captured?: CapturedPage | null;
  /** Current selection on the page (from the content script). */
  selection?: string;
  /** Folders used recently (activity), shown under "Recent" in the folder picker. */
  recentFolders?: string[];
  /** Hashtag suggestions from the server (the last answer for this page). */
  suggestions?: string[];
  /** Number of captures waiting in the queue. */
  queueSize?: number;
  /** Previews/tests: start in a later state. */
  initial?: { mode?: CaptureMode; result?: SubmitResult; menu?: "folder" | "remind" | "more"; note?: string };
}

const TINY = 130;

/** The page card: cover (or a monogram), title in 600, meta line (domain, kind, reading time / duration). */
export function PageCard({ page, cover, onBrokenCover, meta }: { page: PageMeta; cover: string | null; onBrokenCover?: () => void; meta?: ReactNode }) {
  const kind = detectKind(page.url);
  const video = kind.type === "video" || kind.type === "podcast";
  const parts: ReactNode[] = [page.domain];
  if (page.media && mediaLine(page.media)) parts.push(mediaLine(page.media));
  else if (page.reading_minutes) parts.push(t("{n} min", { n: page.reading_minutes }));
  if (page.transcript) parts.push(t("Transcript found"));
  return (
    <div className="rx-pcard">
      <div className="rx-cover">
        {cover ? (
          <img
            key={cover}
            src={cover}
            alt=""
            referrerPolicy="no-referrer"
            onError={onBrokenCover}
            onLoad={(e) => e.currentTarget.naturalWidth > 0 && e.currentTarget.naturalWidth < TINY && onBrokenCover?.()}
          />
        ) : (
          <span aria-hidden>{page.domain.slice(0, 1).toUpperCase()}</span>
        )}
        {video && cover && (
          <span className="rx-play" aria-hidden>
            <Play size={16} fill="currentColor" stroke="none" />
          </span>
        )}
      </div>
      <div className="rx-grow">
        <div className="rx-pt rx-clamp2">{page.title}</div>
        <div className="rx-pm">
          {(meta ? [meta] : parts).map((p, i) => (
            <span key={i} style={{ display: "contents" }}>
              {i > 0 && <span className="rx-dotsep">·</span>}
              <span className="rx-trunc">{p}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

const dateFmt = (iso: string) => {
  try {
    return new Date(iso).toLocaleDateString(intlLocale(), { day: "numeric", month: "short" });
  } catch {
    return iso.slice(0, 10);
  }
};
const timeFmt = (d = new Date()) => d.toLocaleTimeString(intlLocale(), { hour: "2-digit", minute: "2-digit" });

type Stage = "form" | "sending" | "done";
type Done =
  | { kind: "clip"; result: SubmitResult }
  | { kind: "upload"; result: IngestResponse }
  | { kind: "selection"; result: HighlightOutcome };

/** Header actions shared by every state: side panel ⌥S, tab manager ⌥T, ⋯ (Autosave, options). */
function HeaderActions({ actions, settings, menu, setMenu }: { actions: PopupActions; settings: ExtensionSettings; menu: string | null; setMenu: (m: string | null) => void }) {
  const items: MenuItem[] = [
    ...(actions.setAutosave
      ? [{ key: "autosave", icon: settings.autosave ? <Check /> : <Sparkles />, label: settings.autosave ? t("Turn off Autosave") : t("Turn on Autosave"), right: t("1 click saves") }]
      : []),
    { key: "options", icon: <Settings2 />, label: t("Options"), sep: !!actions.setAutosave },
  ];
  return (
    <>
      {actions.openSidePanel && (
        <IconBtn label={t("Side panel")} kbd={`${ALT}S`} onClick={actions.openSidePanel}>
          <PanelRight />
        </IconBtn>
      )}
      {actions.openManager && (
        <IconBtn label={t("Tab manager")} kbd={`${ALT}T`} onClick={actions.openManager}>
          <LayoutGrid />
        </IconBtn>
      )}
      <IconBtn label={t("More")} pressed={menu === "more"} onClick={() => setMenu(menu === "more" ? null : "more")}>
        <MoreHorizontal />
      </IconBtn>
      {menu === "more" && (
        <Menu
          label={t("More")}
          style={{ right: 8, top: 40, width: 230 }}
          items={items}
          onClose={() => setMenu(null)}
          onPick={(key) => {
            setMenu(null);
            if (key === "autosave") actions.setAutosave?.(!settings.autosave);
            else actions.openOptions();
          }}
        />
      )}
    </>
  );
}

/** Popup when the active tab cannot be captured (browser pages, store, new tab). */
export function BlockedPanel({ actions, settings, reason }: { actions: PopupActions; settings: ExtensionSettings; reason?: string }) {
  const [menu, setMenu] = useState<string | null>(null);
  return (
    <div className="rx rx-popup">
      <LocBar title={t("Capture")}>
        <HeaderActions actions={actions} settings={settings} menu={menu} setMenu={setMenu} />
      </LocBar>
      <EmptyState icon={<Ban aria-hidden />} title={t("This page cannot be captured")}>
        {reason ?? t("Browser pages such as New Tab or Settings are locked. You can still save your open tabs.")}
      </EmptyState>
      <div className="rx-foot">
        {actions.openManager && (
          <Btn variant="soft" kbd={`${ALT}T`} onClick={actions.openManager}>
            <LayoutGrid /> {t("Tab manager")}
          </Btn>
        )}
        {actions.openSidePanel && (
          <Btn onClick={actions.openSidePanel}>
            <PanelRight /> {t("Side panel")}
          </Btn>
        )}
      </div>
    </div>
  );
}

/** Autosave confirmation: one line, F opens the form (adds to the saved entry). */
export function QuickSaved({ page, result, mock, actions, autoCloseMs = AUTOSAVE_CLOSE_MS }: { page: PageMeta; result: SubmitResult; mock: boolean; actions: PopupActions; autoCloseMs?: number }) {
  const cover = page.image_url;
  // Closes by itself after a success, like the classic confirmation; pointer or focus inside holds it open.
  const [hold, setHold] = useState(false);
  const success = result.ok && result.delivered;
  useEffect(() => {
    if (!success || hold || autoCloseMs <= 0) return;
    const timer = setTimeout(actions.close, autoCloseMs);
    return () => clearTimeout(timer);
  }, [success, hold, autoCloseMs, actions]);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      if (e.key === "f" || e.key === "F") actions.openForm?.();
      if (e.key === "Escape") actions.close();
    };
    document.addEventListener("keydown", on);
    return () => document.removeEventListener("keydown", on);
  }, [actions]);
  const tone = !result.ok ? "crit" : !result.delivered ? "warn" : "ok";
  const head = !result.ok
    ? describeFailure({ ok: false, error: result.error as IngestFailure["error"] }).title
    : !result.delivered
      ? t("Saved offline, will be sent")
      : mock
        ? t("Saved locally")
        : result.response.duplicate
          ? t("Already in Kortex, merged")
          : t("Saved to Kortex");
  const where = result.ok && result.delivered ? (result.response.auto_routed ? t("Auto") : result.response.folder_path) : !result.ok ? result.error.message : t("Queue");
  return (
    <div className="rx rx-popup" onPointerEnter={() => setHold(true)} onFocusCapture={() => setHold(true)}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", padding: "14px 14px 12px" }}>
        <div className="rx-cover" style={{ width: 44, height: 34 }}>
          {cover ? <img src={cover} alt="" referrerPolicy="no-referrer" /> : <span aria-hidden>{page.domain.slice(0, 1).toUpperCase()}</span>}
        </div>
        <div className="rx-grow" role="status">
          <div style={{ display: "flex", gap: 7, alignItems: "center", fontWeight: 600, letterSpacing: "-0.012em" }}>
            <span className={`rx-dot rx-dot--${tone}`} aria-hidden />
            {head}
          </div>
          <div className="rx-pm rx-trunc" style={{ display: "block" }}>
            {page.title} <span className="rx-dotsep">·</span> {where}
          </div>
        </div>
        <IconBtn small label={t("Close")} onClick={actions.close}>
          <X />
        </IconBtn>
      </div>
      <div className="rx-foot">
        {actions.openForm && (
          <Btn variant="soft" kbd="F" onClick={actions.openForm}>
            <Pencil /> {t("With form")}
          </Btn>
        )}
        {result.ok && result.delivered && !mock && actions.openItem && (
          <Btn onClick={() => actions.openItem!(result.response.item_id)}>
            <ExternalLink /> {t("Open in Kortex")}
          </Btn>
        )}
        <span className="rx-grow" />
        <span className="rx-faint" style={{ fontSize: 11.5 }}>
          {t("Autosave on")}
        </span>
      </div>
    </div>
  );
}

/** The agent's steps for a saved page, following the server pipeline. */
export function agentSteps(page: PageMeta, done: Done, pipeline: Pipeline | null, mock: boolean, summaryLevel: string, folderGuess: string): Step[] {
  if (done.kind === "selection") {
    return done.result.ok
      ? [
          { key: "hl", state: "done", label: t("Highlight saved"), right: done.result.text },
          { key: "page", state: "wait", label: t("The page is filed with it") },
        ]
      : [{ key: "hl", state: "fail", label: done.result.message }];
  }
  if (mock) {
    return [
      { key: "local", state: "done", label: t("Saved in this browser") },
      { key: "later", state: "wait", label: t("Summary, filing and links run once Kortex is connected") },
    ];
  }
  const response = done.kind === "clip" ? (done.result.ok && done.result.delivered ? done.result.response : null) : done.result.ok ? done.result : null;
  if (!response) return [];
  const final = pipeline?.final ?? (response.status === "processed" || response.status === "archived");
  const failed = pipeline?.tone === "error";
  // usePipelineOf puts the final folder into `detail` of a finished pipeline
  const finalFolder = pipeline?.final && pipeline.tone === "ok" && pipeline.detail ? pipeline.detail : response.folder_path;
  const read: Step =
    done.kind === "upload"
      ? { key: "read", state: final ? "done" : "run", label: t("Reading the image (OCR)") }
      : {
          key: "read",
          state: "done",
          label: response.duplicate ? t("Merged with the existing entry") : page.transcript ? t("Transcript read") : t("Page read"),
          right: page.transcript ? transcriptHint(page.transcript).replace(/^[^(]*\(|\)$/g, "") : page.reading_minutes ? t("{n} min", { n: page.reading_minutes }) : undefined,
        };
  if (failed) return [read, { key: "fail", state: "fail", label: t("Processing failed"), right: pipeline?.detail }];
  return [
    read,
    { key: "tldr", state: final ? "done" : "run", label: t("Summary"), right: summaryLevel === "detailed" ? t("Detailed") : t("Concise") },
    {
      key: "file",
      state: final ? "done" : read.state === "done" ? "run" : "wait",
      label: final ? t("Filed") : t("Filing"),
      right: final ? <FolderPath path={finalFolder} /> : response.auto_routed ? t("Auto, probably {space}", { space: folderGuess }) : <FolderPath path={response.folder_path} />,
    },
    { key: "link", state: final ? "done" : "wait", label: t("Linking with objects and notes") },
  ];
}

/** Polls the pipeline (like usePipeline) and keeps the last answer. */
function usePipelineOf(itemId: string | null, fetchStatus?: StatusFetcher) {
  const [state, setState] = useState<Pipeline | null>(null);
  useEffect(() => {
    if (!itemId || !fetchStatus || itemId.startsWith("mock-")) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;
    const tick = async () => {
      const res = await fetchStatus(itemId);
      if (!alive) return;
      if (res.ok) {
        const p = describePipeline(res.data);
        setState({ ...p, detail: p.final && p.tone === "ok" ? res.data.folder_path : p.detail });
        if (p.final) return;
      }
      if (++polls < 45) timer = setTimeout(() => void tick(), 2000);
    };
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [itemId, fetchStatus]);
  return state;
}

export function CapturePanel({ page, settings, mock, actions, captured, selection, recentFolders = [], suggestions, queueSize = 0, initial }: CapturePanelProps) {
  const kind = detectKind(page.url);
  const video = kind.type === "video" || kind.type === "podcast";
  const options = useMemo(() => tagOptions(page, settings.defaultTags, suggestions), [page, settings.defaultTags, suggestions]);
  const [extraTags, setExtraTags] = useState<string[]>([]);
  const [tagOn, setTagOn] = useState(() => options.map((o) => o.on));
  const [tagDraft, setTagDraft] = useState<string | null>(null);
  const defaults = defaultClipChoice(page, settings, suggestions);
  const [folder, setFolder] = useState<string | null>(defaults.folder);
  const [mode, setMode] = useState<CaptureMode>(initial?.mode ?? "page");
  const [note, setNote] = useState(initial?.note ?? "");
  const [menu, setMenu] = useState<string | null>(initial?.menu ?? null);
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState<Stage>(initial?.result ? "done" : "form");
  const [done, setDone] = useState<Done | null>(initial?.result ? { kind: "clip", result: initial.result } : null);
  const [remindState, setRemindState] = useState<{ ok: boolean; text: string } | null>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  // Cover: ranked candidates; broken ones are skipped, the user can pick another or none.
  const covers = useMemo(() => (page.image_candidates?.length ? page.image_candidates : page.image_url ? [page.image_url] : []), [page]);
  const [broken, setBroken] = useState<number[]>([]);
  const [coverIdx, setCoverIdx] = useState(0);
  const usable = covers.map((url, i) => ({ url, i })).filter((c) => !broken.includes(c.i));
  const cover = coverIdx < 0 ? null : (usable.find((c) => c.i >= coverIdx) ?? null);

  const chosenTags = [...options.filter((_, i) => tagOn[i]).map((o) => o.tag), ...extraTags];
  const hasSelection = !!selection?.trim() && !!actions.highlightSelection;

  const response = done?.kind === "clip" && done.result.ok && done.result.delivered ? done.result.response : done?.kind === "upload" && done.result.ok ? done.result : null;
  const pipeline = usePipelineOf(response && (response.status === "inbox" || response.status === "processing") ? response.item_id : null, actions.fetchStatus);

  const submit = useCallback(async () => {
    if (stage !== "form") return;
    setStage("sending");
    setMenu(null);
    if (mode === "selection" && actions.highlightSelection) {
      const result = await actions.highlightSelection({ note });
      setDone({ kind: "selection", result });
    } else if (mode === "screenshot" && actions.uploadScreenshot) {
      const source = t("Source: {url}", { url: page.url });
      const result = await actions.uploadScreenshot({
        title: t("Screenshot: {title}", { title: page.title }).slice(0, 300),
        note: [note.trim(), source].filter(Boolean).join("\n\n"),
        folder_path: folder,
        tags: chosenTags,
      });
      setDone({ kind: "upload", result });
    } else {
      const result = await actions.send(
        buildWebClip(page, { folder, tags: chosenTags, note, image: cover?.url ?? null, summaryLevel: settings.summaryLevel }),
      );
      setDone({ kind: "clip", result });
    }
    setStage("done");
  }, [stage, mode, actions, note, page, folder, chosenTags, cover, settings.summaryLevel]);

  const failed: { title: string; message: string; unauthorized: boolean; options: boolean } | null = (() => {
    if (!done || done.kind === "selection") return null;
    const r = done.result;
    if (r.ok) return null;
    const view = describeFailure({ ok: false, error: r.error as IngestFailure["error"] });
    return { title: view.title, message: view.message, unauthorized: r.error.code === "unauthorized" || r.error.code === "setup_required", options: view.action === "options" };
  })();
  const queued = done?.kind === "clip" && done.result.ok && !done.result.delivered ? done.result : null;
  const savedItemId = response?.item_id ?? null;
  const reminds = useMemo(() => remindChoices(new Date(), intlLocale(getLocale())), []);

  const pickRemind = useCallback(
    async (key: string) => {
      setMenu(null);
      const c = reminds.find((r) => r.key === key);
      if (!c || !savedItemId || !actions.remind) return;
      const res = await actions.remind(savedItemId, c.iso);
      setRemindState(res.ok ? { ok: true, text: t("Reminder: {when}", { when: `${c.label}, ${c.when}` }) } : { ok: false, text: res.error.message });
    },
    [reminds, savedItemId, actions],
  );

  // Keyboard: Enter / ⌘↵ saves, O opens, R reminds, Esc closes; Tab moves through the fields.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (menu) return; // the open menu handles its keys
      if (stage === "form") {
        if (e.key === "Enter" && (modKey(e) || !isTyping(e))) {
          if ((e.target as HTMLElement | null)?.closest?.("button")) return;
          e.preventDefault();
          void submit();
        } else if (e.key === "Escape") actions.close();
        return;
      }
      if (stage !== "done" || isTyping(e)) return;
      if ((e.key === "o" || e.key === "O") && savedItemId && !mock && actions.openItem) actions.openItem(savedItemId);
      else if ((e.key === "r" || e.key === "R") && savedItemId && !mock && actions.remind) setMenu("remind");
      else if (e.key === "Escape") actions.close();
    };
    document.addEventListener("keydown", on);
    return () => document.removeEventListener("keydown", on);
  }, [menu, stage, submit, savedItemId, mock, actions]);

  useEffect(() => {
    if (stage === "form" && !initial?.menu) noteRef.current?.focus({ preventScroll: true });
  }, [stage, initial?.menu]);

  /* ---------- after saving ---------- */
  if (stage === "done" && done) {
    if (failed) {
      return (
        <div className="rx rx-popup">
          <LocBar title={t("Not sent")} extra={<span className="rx-dot rx-dot--crit" aria-hidden style={{ marginLeft: 2 }} />}>
            <HeaderActions actions={actions} settings={settings} menu={menu} setMenu={setMenu} />
          </LocBar>
          <PageCard page={page} cover={cover?.url ?? null} />
          <div className="rx-popup-pad" style={{ paddingBottom: 14 }}>
            <Banner tone="crit" icon={failed.unauthorized ? <KeyRound aria-hidden /> : <CloudOff aria-hidden />} title={failed.unauthorized ? t("Kortex rejected the token") : failed.title}>
              {failed.unauthorized ? t("Nothing was saved. With a valid token in the options it goes through.") : failed.message}
            </Banner>
          </div>
          <div className="rx-foot">
            {failed.options ? (
              <Btn variant="pri" onClick={() => actions.openOptions("connection")}>
                {failed.unauthorized ? t("Renew token") : t("Open options")}
              </Btn>
            ) : null}
            <Btn variant={failed.options ? "ghost" : "soft"} onClick={() => (setStage("form"), setDone(null))}>
              {t("Back")}
            </Btn>
          </div>
        </div>
      );
    }
    if (queued) {
      return (
        <div className="rx rx-popup">
          <LocBar title={t("Saved offline")} extra={<span className="rx-dot rx-dot--warn" aria-hidden style={{ marginLeft: 2 }} />}>
            <HeaderActions actions={actions} settings={settings} menu={menu} setMenu={setMenu} />
          </LocBar>
          <PageCard page={page} cover={cover?.url ?? null} />
          <div style={{ padding: "0 16px 14px" }}>
            <Steps
              label={t("Delivery")}
              steps={[
                { key: "kept", state: "done", label: t("Stored safely in the browser") },
                {
                  key: "wait",
                  state: "run",
                  label: queued.code === "not_configured" ? t("Kortex is not set up yet") : t("Kortex unreachable"),
                  right: t("next try in 1 min"),
                },
              ]}
            />
          </div>
          <div className="rx-foot">
            {actions.flush && (
              <Btn variant="soft" onClick={actions.flush}>
                {t("Send again now")}
              </Btn>
            )}
            <Btn onClick={() => actions.openOptions("queue")}>
              {t("Queue")} <span className="rx-faint rx-num">{Math.max(queueSize, 1)}</span>
            </Btn>
          </div>
        </div>
      );
    }
    const steps = agentSteps(page, done, pipeline, mock, settings.summaryLevel, kind.space);
    const live = !!savedItemId && !mock;
    return (
      <div className="rx rx-popup">
        <LocBar title={t("Saved")} extra={<span className="rx-dot rx-dot--ok" aria-hidden style={{ marginLeft: 2 }} />}>
          <HeaderActions actions={actions} settings={settings} menu={menu} setMenu={setMenu} />
        </LocBar>
        <PageCard page={page} cover={cover?.url ?? null} />
        <div style={{ padding: "0 16px 12px" }}>
          <div className="rx-lab" style={{ minHeight: 24 }}>
            <Bot aria-hidden /> {t("Kortex agent")} <span className="rx-c">{pipeline?.final ? t("done, {time}", { time: timeFmt() }) : t("working in the background")}</span>
          </div>
          <Steps steps={steps} label={t("Kortex agent")} />
          {done.kind === "clip" && done.result.ok && done.result.notices?.map((n) => (
            <div key={n} className="rx-faint" style={{ fontSize: 12, marginTop: 6 }} role="note">
              {t("Note: {note}", { note: n })}
            </div>
          ))}
          {remindState && (
            <div className={remindState.ok ? "rx-muted" : "rx-btn--crit"} style={{ fontSize: 12.5, marginTop: 8, display: "flex", gap: 6, alignItems: "center" }} role="status">
              <Bell size={13} aria-hidden /> {remindState.text}
            </div>
          )}
        </div>
        <div className="rx-foot" style={{ position: "relative" }}>
          {live && actions.openItem && (
            <Btn variant="soft" kbd="O" onClick={() => actions.openItem!(savedItemId!)}>
              <ExternalLink /> {t("Open in Kortex")}
            </Btn>
          )}
          {live && actions.remind && (
            <Btn variant="line" kbd="R" aria-expanded={menu === "remind"} onClick={() => setMenu(menu === "remind" ? null : "remind")}>
              <Bell /> {t("Remind")}
            </Btn>
          )}
          {!live && (
            <Btn variant="soft" onClick={actions.close}>
              {t("Close")}
            </Btn>
          )}
          <span className="rx-grow" />
          {menu === "remind" && (
            <Menu
              label={t("Bring back")}
              style={{ left: 110, right: 16, bottom: 48 }}
              onClose={() => setMenu(null)}
              onPick={(k) => void pickRemind(k)}
              items={reminds.map((r, i) => ({
                key: r.key,
                group: i === 0 ? t("Bring back") : undefined,
                icon: <Clock />,
                label: r.label,
                right: (
                  <>
                    {r.when} <kbd className="rx-kbd">{i + 1}</kbd>
                  </>
                ),
              }))}
            />
          )}
        </div>
      </div>
    );
  }

  /* ---------- form ---------- */
  const q = query.trim().toLowerCase();
  const own = settings.clipFolders.filter((f) => f.toLowerCase().includes(q));
  const recent = recentFolders.filter((f) => !settings.clipFolders.includes(f) && f.toLowerCase().includes(q)).slice(0, 4);
  const folderItems: MenuItem[] = [
    ...(!q || t("Auto").toLowerCase().includes(q)
      ? [{ key: "\u0000auto", icon: <Sparkles style={{ color: "var(--accent-ink)" }} />, label: <>{t("Auto")} <span className="rx-faint" style={{ fontSize: 12 }}>{t("Agent decides")}</span></>, right: <kbd className="rx-kbd">↵</kbd> }]
      : []),
    ...own.map((f, i) => ({ key: f, group: i === 0 ? t("Your folders") : undefined, icon: <Folder />, label: <FolderPath path={f} />, right: f === folder ? <Check size={13} /> : undefined })),
    ...recent.map((f, i) => ({ key: f, group: i === 0 ? t("Recent") : undefined, icon: <Folder />, label: <FolderPath path={f} /> })),
  ];
  const newFolder = query.trim().replace(/^\/+|\/+$/g, "");
  if (newFolder && ![...settings.clipFolders, ...recentFolders].some((f) => f.toLowerCase() === newFolder.toLowerCase())) {
    folderItems.push({ key: `\u0000new:${newFolder}`, sep: folderItems.length > 0, muted: true, icon: <Plus />, label: t("New folder “{name}”", { name: newFolder }), right: <kbd className="rx-kbd">{MOD}↵</kbd> });
  }
  const pickFolder = (key: string) => {
    setMenu(null);
    setQuery("");
    if (key === "\u0000auto") setFolder(null);
    else if (key.startsWith("\u0000new:")) setFolder(key.slice(5));
    else setFolder(key);
  };

  const modes = [
    { value: "page" as const, label: video ? (page.transcript ? t("Video + transcript") : t("Video")) : t("Page"), icon: video ? <Video /> : <FileText /> },
    {
      value: "selection" as const,
      label: t("Selection"),
      icon: <TextSelect />,
      disabled: !hasSelection,
      title: hasSelection ? undefined : t("Select text on the page first"),
    },
    {
      value: "screenshot" as const,
      label: video ? t("Image") : t("Screenshot"),
      icon: <Camera />,
      disabled: !actions.uploadScreenshot,
      title: actions.uploadScreenshot ? t("Saves the visible part of the page as an image (with text recognition)") : t("Not available on this page"),
    },
  ];
  const local = mock && !settings.token.trim();
  const saveLabel = mode === "selection" ? t("Save highlight") : captured && mode === "page" ? t("Add to it") : local ? t("Save locally") : t("Save");

  return (
    <div className="rx rx-popup">
      <LocBar
        title={t("Capture")}
        extra={
          mock ? (
            <span className="rx-faint" style={{ fontSize: 12, display: "flex", gap: 5, alignItems: "center", marginLeft: 4 }}>
              <span className="rx-dot rx-dot--off" aria-hidden />
              {t("local")}
            </span>
          ) : undefined
        }
      >
        <HeaderActions actions={actions} settings={settings} menu={menu === "more" ? "more" : null} setMenu={setMenu} />
      </LocBar>
      <PageCard page={page} cover={mode === "screenshot" ? null : (cover?.url ?? null)} onBrokenCover={() => cover && setBroken((b) => [...b, cover.i])} />
      <div className="rx-popup-pad">
        <Seg label={t("What to capture")} options={modes} value={mode} onChange={setMode} />
      </div>
      {local && (
        <div className="rx-popup-pad">
          <Banner icon={<CloudOff aria-hidden />} title={t("Not connected to Kortex")} action={{ label: t("Connect"), onClick: () => actions.openOptions("connection") }}>
            {t("Saves in this browser (local mode). Connect Kortex in the options to send.")}
          </Banner>
        </div>
      )}
      {captured && mode === "page" && (
        <div className="rx-popup-pad">
          <Banner icon={<Layers aria-hidden />} title={captured.local ? t("Already saved locally, since {date}", { date: dateFmt(captured.at) }) : t("Already in Kortex, since {date}", { date: dateFmt(captured.at) })}>
            {t("New things are added, nothing is overwritten: note, tags and highlights.")}
          </Banner>
        </div>
      )}
      {mode === "selection" && hasSelection && (
        <div className="rx-quote">
          <span className="rx-hl-bar" data-hl="yellow" aria-hidden />
          <span className="rx-clamp2">{selection}</span>
        </div>
      )}
      {mode !== "selection" && (
        <div className="rx-props" style={{ position: "relative" }}>
          <PropRow
            icon={<Folder aria-hidden />}
            label={t("Folder")}
            open={menu === "folder"}
            onClick={() => setMenu(menu === "folder" ? null : "folder")}
            chevron={<ChevronDown size={13} aria-hidden />}
          >
            {folder ? (
              <FolderPath path={folder} />
            ) : (
              <>
                <span className="rx-auto">
                  <Sparkles aria-hidden />
                  {t("Auto")}
                </span>
                <span className="rx-faint rx-trunc">{captured?.folder_path ? <FolderPath path={captured.folder_path} /> : kind.space}</span>
              </>
            )}
          </PropRow>
          {menu === "folder" && (
            <Menu
              label={t("Choose folder")}
              style={{ left: 8, right: 8, top: 34 }}
              items={folderItems}
              onPick={pickFolder}
              onClose={() => (setMenu(null), setQuery(""))}
              search={{ value: query, onChange: setQuery, placeholder: t("Find or create a folder"), onModEnter: newFolder ? () => pickFolder(`\u0000new:${newFolder}`) : undefined }}
            />
          )}
          <PropRow icon={<Hash aria-hidden />} label={t("Tags")}>
            {options.map((o, i) => (
              <TagDot key={o.tag} tag={o.tag} on={!!tagOn[i]} onToggle={() => setTagOn((s) => s.map((v, j) => (j === i ? !v : v)))} />
            ))}
            {extraTags.map((tag) => (
              <TagDot key={tag} tag={tag} on onToggle={() => setExtraTags((x) => x.filter((y) => y !== tag))} />
            ))}
            {tagDraft === null ? (
              <button type="button" className="rx-tag rx-faint" aria-label={t("Add tag")} title={t("Add tag")} onClick={() => setTagDraft("")}>
                <Plus size={12} aria-hidden />
              </button>
            ) : (
              <input
                className="rx-tag-input"
                autoFocus
                value={tagDraft}
                placeholder={t("tag")}
                aria-label={t("New tag")}
                onChange={(e) => setTagDraft(e.target.value)}
                onBlur={() => setTagDraft(null)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    e.stopPropagation();
                    const tag = normalizeUserTag(tagDraft);
                    if (tag && !chosenTags.includes(tag) && !options.some((o) => o.tag === tag)) setExtraTags((x) => [...x, tag]);
                    else if (tag) setTagOn((s) => s.map((v, j) => (options[j]?.tag === tag ? true : v)));
                    setTagDraft("");
                  } else if (e.key === "Escape") {
                    e.stopPropagation();
                    setTagDraft(null);
                  }
                }}
              />
            )}
            {options.length === 0 && extraTags.length === 0 && tagDraft === null && <span className="rx-faint">{t("none")}</span>}
          </PropRow>
          {mode === "page" && usable.length > 1 && (
            <PropRow icon={<ImageIcon aria-hidden />} label={t("Cover")}>
              <span className="rx-covers" role="group" aria-label={t("Choose cover")}>
                {usable.slice(0, 4).map((c, n) => (
                  <button key={c.url} type="button" aria-label={t("Cover {n}", { n: n + 1 })} aria-pressed={cover?.i === c.i} onClick={() => setCoverIdx(c.i)}>
                    <img src={c.url} alt="" referrerPolicy="no-referrer" onError={() => setBroken((b) => [...b, c.i])} />
                  </button>
                ))}
                <button type="button" aria-label={t("No cover")} title={t("No cover")} aria-pressed={!cover} onClick={() => setCoverIdx(-1)}>
                  <Ban aria-hidden />
                </button>
              </span>
            </PropRow>
          )}
        </div>
      )}
      <div style={{ padding: "6px 14px 12px" }}>
        <label className="rx-field rx-field--area">
          <textarea
            ref={noteRef}
            rows={2}
            value={note}
            maxLength={LIMITS.note}
            placeholder={captured && mode === "page" ? t("Add a note …") : t("Note: why does this matter?")}
            aria-label={t("Note (optional)")}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
          />
        </label>
        {page.capture_notes?.map((n) => (
          <div key={n} className="rx-faint" style={{ fontSize: 12, marginTop: 6 }}>
            {n}
          </div>
        ))}
      </div>
      <div className="rx-foot rx-foot--stack">
        <Btn variant="pri" big block kbd="↵" disabled={stage === "sending"} onClick={() => void submit()}>
          {stage === "sending" ? t("Saving …") : saveLabel}
        </Btn>
        <Hints
          items={[
            { kbd: "Tab", label: t("Fields") },
            ...(actions.openSidePanel ? [{ kbd: `${ALT}S`, label: t("Side panel") }] : []),
            { kbd: `${ALT}T`, label: t("Tabs") },
          ]}
          right={
            <span>
              <kbd className="rx-kbd">Esc</kbd>
            </span>
          }
        />
      </div>
    </div>
  );
}
