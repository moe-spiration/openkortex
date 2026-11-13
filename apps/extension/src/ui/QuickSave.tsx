import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { AppMark, Button, Eyebrow } from "@kortex/ui";
import { PRODUCT_NAME, t } from "../i18n";
import type { IngestFailure } from "../lib/api";
import { describeFailure } from "../lib/errors";
import type { IngestSender, StatusFetcher } from "../lib/messages";
import type { SubmitResult } from "../lib/outbox";
import type { PageMeta } from "../lib/page-meta";
import { buildWebClip, defaultClipChoice } from "../lib/requests";
import type { ExtensionSettings } from "../lib/settings";
import { ClipSettings, type ClipSettingsPatch } from "./ClipSettings";
import { ServerOutcome } from "./ClipperPanel";
import { StatusChip } from "./StatusChip";

/** How long the saved confirmation stays before the popup closes by itself. */
export const AUTOSAVE_CLOSE_MS = 2500;

export interface QuickSaveProps {
  page: PageMeta;
  settings: Pick<ExtensionSettings, "clipFolders" | "defaultTags" | "defaultRoute" | "summaryLevel" | "autosave">;
  send: IngestSender;
  onClose: () => void;
  mock?: boolean;
  onOpenOptions?: () => void;
  fetchStatus?: StatusFetcher;
  onSettingsChange?: (patch: ClipSettingsPatch) => void;
  suggestions?: string[];
  /** 0 = stay open (previews). */
  autoCloseMs?: number;
}

/**
 * C2 Autosave: the toolbar click saves at once with the clipper defaults (route, hashtags, cover,
 * summary level); this is only the short confirmation, closing itself unless the pointer rests on it.
 * Offline captures go to the outbox like any other and are reported as "wird nachgeliefert".
 */
export function QuickSave({
  page,
  settings,
  send,
  onClose,
  mock,
  onOpenOptions,
  fetchStatus,
  onSettingsChange,
  suggestions,
  autoCloseMs = AUTOSAVE_CLOSE_MS,
}: QuickSaveProps) {
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [hold, setHold] = useState(false);
  const [prefs, setPrefs] = useState({ summaryLevel: settings.summaryLevel, autosave: settings.autosave });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // exactly one capture per click, also under StrictMode
    started.current = true;
    void send(buildWebClip(page, defaultClipChoice(page, settings, suggestions))).then(setResult);
  }, [page, settings, send, suggestions]);

  const saved = result?.ok === true;
  useEffect(() => {
    if (!saved || hold || autoCloseMs <= 0) return;
    const timer = setTimeout(onClose, autoCloseMs);
    return () => clearTimeout(timer);
  }, [saved, hold, autoCloseMs, onClose]);

  const change = (patch: ClipSettingsPatch) => {
    setHold(true);
    setPrefs((p) => ({ ...p, ...patch }));
    onSettingsChange?.(patch);
  };
  const liveResponse = !mock && result?.ok && result.delivered ? result.response : null;

  return (
    <div
      className="kx-clip kx-clip--popup grid gap-3"
      role="dialog"
      aria-label={`${PRODUCT_NAME} Autosave`}
      onPointerEnter={() => setHold(true)}
      onFocusCapture={() => setHold(true)}
    >
      <div className="kxh-row">
        <AppMark size={18} />
        <strong className="kx-t-h3">Autosave</strong>
        <span className="kxh-grow" />
        <Button variant="ghost" size="icon" aria-label={t("Close")} onClick={onClose} className="min-h-11 min-w-11 rounded-lg">
          <X />
        </Button>
      </div>

      <div className="grid gap-0.5">
        <strong className="kx-clamp2 kx-t-body-strong">{page.title}</strong>
        <span className="kx-domain">{page.domain}</span>
      </div>

      <div className="grid gap-2" role="status" aria-live="polite">
        {!result ? (
          <div className="kxh-row">
            <span className="kx-spinner" aria-hidden />
            <span className="kx-t-body text-secondary">{t("Saving")}</span>
          </div>
        ) : !result.ok ? (
          <AutosaveFailure result={result} onOpenOptions={onOpenOptions} />
        ) : liveResponse ? (
          <ServerOutcome response={liveResponse} fetchStatus={fetchStatus} />
        ) : result.delivered ? (
          <StatusChip tone="ok">{t("Saved to Kortex Inbox")}</StatusChip>
        ) : (
          <>
            <StatusChip tone="warn">{t("Saved offline")}</StatusChip>
            <span className="kx-t-meta text-secondary">
              {result.code === "not_configured"
                ? t("The server is not set up yet: will be delivered automatically.")
                : t("Kortex is unreachable right now: will be delivered automatically.")}
            </span>
          </>
        )}
        {mock && saved && <Eyebrow>{t("Mock mode: nothing was sent to a server.")}</Eyebrow>}
      </div>

      {onSettingsChange && (
        <div className="kx-clip-foot grid gap-1">
          <ClipSettings summaryLevel={prefs.summaryLevel} autosave={prefs.autosave} onChange={change} />
          {!prefs.autosave && (
            <span className="kx-t-meta text-muted">{t("From the next click on, the form with folder, hashtags and note opens again.")}</span>
          )}
        </div>
      )}
    </div>
  );
}

function AutosaveFailure({ result, onOpenOptions }: { result: Extract<SubmitResult, { ok: false }>; onOpenOptions?: () => void }) {
  const view = describeFailure({ ok: false, error: result.error as IngestFailure["error"] });
  return (
    <div className="grid gap-2" role="alert">
      <StatusChip tone="error">{view.title}</StatusChip>
      <span className="kx-t-body text-secondary">{view.message}</span>
      {view.action === "options" && onOpenOptions && (
        <Button className="min-h-11 w-full rounded-lg" onClick={onOpenOptions}>
          {t("Open options")}
        </Button>
      )}
    </div>
  );
}
