import { useMemo, useState } from "react";
import { FileText, Folder, Inbox, Route, X } from "lucide-react";
import { AppMark, Button, Eyebrow, HashtagPill, Keys, SegmentedTabs, cn } from "@kortex/ui";
import { PRODUCT_NAME, t } from "../i18n";
import type { IngestFailure } from "../lib/api";
import { describeFailure } from "../lib/errors";
import { LIMITS } from "../lib/limits";
import type { IngestSender, RemindSender, StatusFetcher } from "../lib/messages";
import { remindOptions } from "../lib/remind";
import type { PageMeta } from "../lib/page-meta";
import { buildWebClip } from "../lib/requests";
import { describeAccepted, mediaLine, transcriptHint } from "../lib/result";
import type { SubmitResult } from "../lib/outbox";
import type { ExtensionSettings } from "../lib/settings";
import { StatusChip } from "./StatusChip";
import { usePipeline } from "./usePipeline";
import { detectKind, tagOptions } from "../lib/suggest";
import { ClipSettings, type ClipSettingsPatch } from "./ClipSettings";

export interface ClipperPanelProps {
  page: PageMeta;
  settings: Pick<ExtensionSettings, "clipFolders" | "defaultTags" | "defaultRoute"> &
    Partial<Pick<ExtensionSettings, "summaryLevel" | "autosave">>;
  send: IngestSender;
  onClose: () => void;
  /** `floating` = the Alt+K card of the prototype; `popup` = flush with the browser action popup. */
  variant?: "floating" | "popup";
  /** Shows a quiet "nothing is sent" note. */
  mock?: boolean;
  onOpenOptions?: () => void;
  /** Follows the server pipeline after a live capture ("Verarbeitet", final folder). */
  fetchStatus?: StatusFetcher;
  /** Snooze a saved clip ("Erinnere mich"); the row only shows after a live, delivered capture. */
  remind?: RemindSender;
  /** Hashtag suggestions from the server; replaces the local keyword heuristics when given. */
  suggestions?: string[];
  /** Start in the done state (previews / tests). */
  initialStage?: Stage;
  /** The answer shown in the done/error state when starting there (previews / tests). */
  initialResult?: SubmitResult;
  /** Popup: shows summary detail (C1) and Autosave (C2) below the form and saves changes. */
  onSettingsChange?: (patch: ClipSettingsPatch) => void;
}

type Stage = "form" | "sending" | "done" | "error";
type Route = "auto" | "manual";

/**
 * Hashtag choice: a neutral chip (dashed = suggestion, solid = selected) around the quiet tag, so
 * the tag colour shows only as its dot (V2-11E).
 */
export function TagToggle({ tag, on, onToggle }: { tag: string; on: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="kx-tagchip" aria-pressed={on} onClick={onToggle}>
      <HashtagPill tag={tag} variant="quiet" size="sm" />
    </button>
  );
}

/** Placeholder images some hosts answer with when the real one is missing are tiny (YouTube: 120x90). */
const TINY = 130;

function Thumb({ page, src, onBroken }: { page: PageMeta; src: string | null; onBroken: () => void }) {
  return (
    <div className="kx-bookmark-thumb">
      {src ? (
        <img
          key={src}
          className="kx-photo"
          src={src}
          alt=""
          referrerPolicy="no-referrer"
          onError={onBroken}
          onLoad={(e) => e.currentTarget.naturalWidth > 0 && e.currentTarget.naturalWidth < TINY && onBroken()}
        />
      ) : (
        <div className="type-display grid h-full place-items-center text-muted" aria-hidden>
          {page.domain.slice(0, 1).toUpperCase()}
        </div>
      )}
    </div>
  );
}

export function ClipperPanel({
  page,
  settings,
  send,
  onClose,
  variant = "floating",
  mock,
  onOpenOptions,
  fetchStatus,
  remind,
  suggestions,
  initialStage = "form",
  initialResult,
  onSettingsChange,
}: ClipperPanelProps) {
  const kind = detectKind(page.url);
  // Default tags pre-selected, then the suggestions (the first two pre-selected, the rest dashed).
  const options = useMemo(() => tagOptions(page, settings.defaultTags, suggestions), [page, settings.defaultTags, suggestions]);

  const [stage, setStage] = useState<Stage>(initialStage);
  const [route, setRoute] = useState<Route>(settings.defaultRoute === "manual" && settings.clipFolders.length > 0 ? "manual" : "auto");
  const [folder, setFolder] = useState(0);
  const [tagOn, setTagOn] = useState(() => options.map((o) => o.on));
  const [note, setNote] = useState("");
  // Cover: the extractors rank candidates; broken ones are skipped, the user can pick another or none.
  const covers = useMemo(() => (page.image_candidates?.length ? page.image_candidates : page.image_url ? [page.image_url] : []), [page]);
  const [brokenCovers, setBrokenCovers] = useState<number[]>([]);
  const [coverIdx, setCoverIdx] = useState(0); // -1 = no cover
  const usable = covers.map((url, i) => ({ url, i })).filter((c) => !brokenCovers.includes(c.i));
  const cover = coverIdx < 0 ? null : (usable.find((c) => c.i >= coverIdx) ?? null);
  const [result, setResult] = useState<SubmitResult | null>(initialResult ?? null);
  const [prefs, setPrefs] = useState({ summaryLevel: settings.summaryLevel ?? "concise", autosave: settings.autosave ?? false });
  const changePrefs = (patch: ClipSettingsPatch) => {
    setPrefs((p) => ({ ...p, ...patch }));
    onSettingsChange?.(patch);
  };

  // What the server really answered (a live, delivered capture) instead of the generic mock/queued text.
  const liveResponse = !mock && result?.ok && result.delivered ? result.response : null;

  const chosenTags = options.filter((_, i) => tagOn[i]).map((o) => o.tag);
  const target = route === "auto" ? kind.space : (settings.clipFolders[folder] ?? kind.space);

  async function submit() {
    setStage("sending");
    const res = await send(
      buildWebClip(page, {
        folder: route === "manual" ? (settings.clipFolders[folder] ?? null) : null,
        tags: chosenTags,
        note,
        image: cover?.url ?? null,
        summaryLevel: prefs.summaryLevel,
      }),
    );
    setResult(res);
    setStage(res.ok ? "done" : "error");
  }

  return (
    <div
      className={cn("kx-clip grid gap-3", variant === "popup" && "kx-clip--popup", variant === "floating" && "kx-slide-up")}
      role="dialog"
      aria-label={`${PRODUCT_NAME} Clipper`}
    >
      <div className="kxh-row">
        <AppMark size={18} />
        <strong className="kx-clip-title">{t("Clip to Kortex")}</strong>
        <span className="kxh-grow" />
        {/* Tactile Craft v2: the shortcut as physical keycaps (decorative, aria-hidden). */}
        <Keys keys={["Alt", "K"]} size="sm" />
        <Button variant="ghost" size="icon-sm" aria-label={t("Close clipper")} onClick={onClose} className="rounded-lg">
          <X />
        </Button>
      </div>

      {stage === "form" && (
        <div className="grid gap-3">
          <div className="kx-bookmark">
            <div className="kx-bookmark-main">
              <Thumb page={page} src={cover?.url ?? null} onBroken={() => cover && setBrokenCovers((b) => [...b, cover.i])} />
              <div className="grid content-start gap-0.5 min-w-0">
                <strong className="kx-clamp2 kx-t-body-strong">{page.title}</strong>
                <span className="kx-domain kx-truncate">{page.domain}</span>
                {page.media && mediaLine(page.media) && <span className="kx-t-meta text-secondary">{mediaLine(page.media)}</span>}
              </div>
            </div>
            {usable.length > 1 && (
              <div className="kx-covers" role="group" aria-label={t("Choose cover")}>
                {usable.slice(0, 5).map((c, n) => (
                  <button
                    key={c.url}
                    type="button"
                    className="kx-cover"
                    aria-label={t("Cover {n}", { n: n + 1 })}
                    aria-pressed={cover?.i === c.i}
                    onClick={() => setCoverIdx(c.i)}
                  >
                    <img src={c.url} alt="" referrerPolicy="no-referrer" onError={() => setBrokenCovers((b) => [...b, c.i])} />
                  </button>
                ))}
                <button type="button" className="kx-cover kx-cover--none" aria-pressed={!cover} onClick={() => setCoverIdx(-1)}>
                  {t("No cover")}
                </button>
              </div>
            )}
            {page.transcript ? (
              <div className="kxh-row kx-t-meta text-secondary">
                <FileText className="size-3.5 shrink-0 text-muted" aria-hidden />
                <span>{transcriptHint(page.transcript)}</span>
              </div>
            ) : (
              page.capture_notes?.map((n) => (
                <span key={n} className="kx-t-meta text-muted">
                  {n}
                </span>
              ))
            )}
          </div>

          <div className="grid gap-1.5">
            <Eyebrow>{t("Filing")}</Eyebrow>
            <SegmentedTabs<Route>
              block
              size="sm"
              aria-label={t("Filing")}
              className="kx-tabs-touch-36"
              value={route}
              onChange={setRoute}
              tabs={[
                { value: "auto", label: t("Auto-routing") },
                { value: "manual", label: t("Choose folder") },
              ]}
            />
            {route === "auto" ? (
              <div className="kxh-row kx-t-meta items-start text-secondary">
                <Route className="mt-0.5 size-3.5 shrink-0 text-muted" aria-hidden />
                <span>{t("Zero setup: Kortex sorts automatically, here probably into {space}.", { space: kind.space })}</span>
              </div>
            ) : (
              <div className="grid gap-0.5">
                {settings.clipFolders.map((f, i) => (
                  <label key={f} className="kx-choice min-h-10">
                    <input type="radio" name="x-folder" className="kx-radio" checked={folder === i} onChange={() => setFolder(i)} />
                    <Folder className="size-3.5 shrink-0 text-muted" aria-hidden />
                    <span>{f}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {options.length > 0 && (
            <div className="grid gap-1.5">
              <Eyebrow>{t("Suggested hashtags")}</Eyebrow>
              <div className="kxh-wrap">
                {options.map((o, i) => (
                  <TagToggle key={o.tag} tag={o.tag} on={!!tagOn[i]} onToggle={() => setTagOn((s) => s.map((v, j) => (j === i ? !v : v)))} />
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-1.5">
            <Eyebrow>
              <label htmlFor="x-note">{t("Note (optional)")}</label>
            </Eyebrow>
            <div className="kx-control">
              <input
                id="x-note"
                placeholder={t("Why is this relevant?")}
                value={note}
                maxLength={LIMITS.note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>

          <Button variant="primary" size="lg" className="kx-clip-cta w-full rounded-lg" onClick={() => void submit()}>
            <Inbox />
            {t("Send to Kortex Inbox")}
          </Button>

          {onSettingsChange && (
            <div className="kx-clip-foot">
              <ClipSettings summaryLevel={prefs.summaryLevel} autosave={prefs.autosave} onChange={changePrefs} />
            </div>
          )}
        </div>
      )}

      {stage === "sending" && (
        <div className="grid gap-2.5 py-7 text-center" role="status">
          <span className="kx-spinner mx-auto" aria-hidden />
          <span className="kx-t-body-strong">{t("Sending to the Inbox")}</span>
          <div className="kx-progress kx-progress--processing">
            <i style={{ width: "60%" }} />
          </div>
        </div>
      )}

      {stage === "done" && (
        <div className="grid gap-3 py-2" role="status">
          {liveResponse ? (
            <ServerOutcome response={liveResponse} fetchStatus={fetchStatus} />
          ) : (
            <>
              <StatusChip tone="ok">{t("Saved to Kortex Inbox")}</StatusChip>
              <span className="kx-t-body text-secondary">
                {t("The AI Gardener processes the article in the background: summary, tags and links to {target}.", { target })}
              </span>
            </>
          )}
          {chosenTags.length > 0 && (
            <div className="kxh-wrap">
              {chosenTags.map((tag) => (
                <HashtagPill key={tag} tag={tag} variant="quiet" />
              ))}
            </div>
          )}
          {liveResponse && remind && <RemindRow itemId={liveResponse.item_id} remind={remind} />}
          {result?.ok && !result.delivered && (
            <Eyebrow>
              {result.code === "not_configured"
                ? t("The server is not set up yet: will be delivered automatically.")
                : t("Unreachable right now: will be delivered automatically.")}
            </Eyebrow>
          )}
          {result?.ok &&
            result.notices?.map((n) => (
              <Eyebrow key={n} role="note">
                {t("Note: {note}", { note: n })}
              </Eyebrow>
            ))}
          {mock && <Eyebrow>{t("Mock mode: nothing was sent to a server.")}</Eyebrow>}
          <Button className="min-h-11 w-full rounded-lg" onClick={onClose}>
            {t("Close")}
          </Button>
        </div>
      )}

      {stage === "error" && result && !result.ok && <FailureView result={result} onBack={() => setStage("form")} onOpenOptions={onOpenOptions} />}
    </div>
  );
}

/** "Erinnere mich": snoozes the saved clip (remind_at) to tonight, tomorrow or next Monday. */
export function RemindRow({ itemId, remind }: { itemId: string; remind: RemindSender }) {
  const [state, setState] = useState<{ label: string } | { error: string } | null>(null);
  const options = useMemo(() => remindOptions(), []);
  async function pick(label: string, iso: string) {
    const res = await remind(itemId, iso);
    setState(res.ok ? { label } : { error: res.error.message });
  }
  return (
    <div className="grid gap-1.5">
      <Eyebrow>{t("Remind me")}</Eyebrow>
      <div className="kxh-wrap">
        {options.map((o) => (
          <Button key={o.key} size="sm" variant="ghost" onClick={() => void pick(o.label, o.iso)}>
            {o.label}
          </Button>
        ))}
      </div>
      {state && "label" in state && (
        <span className="kx-t-body text-secondary" role="status">
          {t("Reminder set: {when}", { when: state.label })}
        </span>
      )}
      {state && "error" in state && (
        <span className="kx-t-body text-secondary" role="alert">
          {t("Reminder not set: {error}", { error: state.error })}
        </span>
      )}
    </div>
  );
}

/** The server's answer: accepted (and where), then the pipeline catching up (processed, final folder). */
export function ServerOutcome({ response, fetchStatus }: { response: Extract<SubmitResult, { ok: true; delivered: true }>["response"]; fetchStatus?: StatusFetcher }) {
  const accepted = describeAccepted(response);
  const stillRunning = response.status === "inbox" || response.status === "processing";
  const pipeline = usePipeline(stillRunning ? response.item_id : null, fetchStatus);
  const shown = pipeline ?? (stillRunning ? { tone: "warn" as const, label: t("Processing"), detail: undefined, final: false } : null);
  return (
    <>
      <StatusChip tone={accepted.tone}>{accepted.headline}</StatusChip>
      <span className="kx-t-body text-secondary">{pipeline?.final && pipeline.tone === "ok" ? pipeline.detail : accepted.placement}</span>
      {accepted.note && <span className="kx-t-meta text-muted">{accepted.note}</span>}
      {shown && (
        <div className="kxh-row" aria-live="polite">
          <StatusChip tone={shown.tone}>{shown.label}</StatusChip>
          {pipeline?.tone === "error" && pipeline.detail && <span className="kx-t-meta text-muted">{pipeline.detail}</span>}
        </div>
      )}
    </>
  );
}

function FailureView({
  result,
  onBack,
  onOpenOptions,
}: {
  result: Extract<SubmitResult, { ok: false }>;
  onBack: () => void;
  onOpenOptions?: () => void;
}) {
  const view = describeFailure({ ok: false, error: result.error as IngestFailure["error"] });
  return (
    <div className="grid gap-3 py-2" role="alert">
      <StatusChip tone="error">{view.title}</StatusChip>
      <span className="kx-t-body text-secondary">{view.message}</span>
      <div className="kxh-row">
        <Button variant="primary" className="min-h-11 flex-1 rounded-lg" onClick={onBack}>
          {t("Back")}
        </Button>
        {view.action === "options" && onOpenOptions && (
          <Button className="min-h-11 flex-1 rounded-lg" onClick={onOpenOptions}>
            {t("Open options")}
          </Button>
        )}
      </div>
    </div>
  );
}
