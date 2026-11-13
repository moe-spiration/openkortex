import { AlignLeft, Zap } from "lucide-react";
import { SegmentedTabs } from "@kortex/ui";
import { msg, t } from "../i18n";
import type { ExtensionSettings, SummaryLevel } from "../lib/settings";

export type ClipSettingsPatch = Partial<Pick<ExtensionSettings, "summaryLevel" | "autosave">>;

const SUMMARY_LEVELS: { value: SummaryLevel; label: string }[] = [
  { value: "concise", label: msg("Concise") },
  { value: "detailed", label: msg("Detailed") },
];

/** The two summary levels with their labels in the current language (call while rendering). */
export const summaryTabs = () => SUMMARY_LEVELS.map((level) => ({ ...level, label: t(level.label) }));

/**
 * C1 + C2 in the popup: summary detail and Autosave, saved straight into the extension settings
 * (the options page shows the same two settings).
 */
export function ClipSettings({
  summaryLevel,
  autosave,
  onChange,
}: {
  summaryLevel: SummaryLevel;
  autosave: boolean;
  onChange: (patch: ClipSettingsPatch) => void;
}) {
  return (
    <div className="kx-clip-settings grid gap-1" role="group" aria-label={t("Clipper settings")}>
      <div className="kxh-row min-h-10">
        <AlignLeft className="size-3.5 shrink-0 text-muted" aria-hidden />
        <span className="kx-t-body text-secondary">{t("Summary")}</span>
        <span className="kxh-grow" />
        <SegmentedTabs<SummaryLevel>
          size="sm"
          aria-label={t("Summary detail")}
          className="kx-tabs-touch-36"
          value={summaryLevel}
          onChange={(level) => onChange({ summaryLevel: level })}
          tabs={summaryTabs()}
        />
      </div>
      <label className="kxh-row min-h-10 cursor-pointer">
        <Zap className="size-3.5 shrink-0 text-muted" aria-hidden />
        <span className="kx-t-body text-secondary">{t("Autosave on clicking the icon")}</span>
        <span className="kxh-grow" />
        <input
          type="checkbox"
          className="kx-switch"
          aria-label="Autosave"
          checked={autosave}
          onChange={(e) => onChange({ autosave: e.target.checked })}
        />
      </label>
      {autosave && (
        <span className="kx-t-meta text-muted pl-[22px]">
          {t("A click on the icon (or Alt+K) saves at once, without a window. The form is available by right-clicking the icon.")}
        </span>
      )}
    </div>
  );
}
