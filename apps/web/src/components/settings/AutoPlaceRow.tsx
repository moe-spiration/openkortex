"use client";

import { ValueRow } from "@/app/(workspace)/settings/rows";
import { DEFAULT_AUTO_PLACE_THRESHOLD, thresholdOf } from "@/lib/placement";
import { useSettings } from "@/lib/settings/store";
import { msg, t } from "@/i18n";

const OPTIONS: { value: number; label: string }[] = [
  { value: 0.5, label: msg("Generous (from 50 % confidence)") },
  { value: 0.7, label: msg("Balanced (from 70 %, default)") },
  { value: 0.85, label: msg("Cautious (from 85 %)") },
  { value: 1, label: msg("Always review") },
];

/**
 * Zero-setup auto-placement: captures the organizer is at least this sure about (folder, tags,
 * type) are filed without asking; the rest waits in the Inbox for "Übernehmen".
 */
export function AutoPlaceRow() {
  const { user, updateUserSettings } = useSettings();
  const current = thresholdOf((user as { auto_place_threshold?: unknown }).auto_place_threshold ?? DEFAULT_AUTO_PLACE_THRESHOLD);
  const known = OPTIONS.find((o) => o.value === current);
  const custom = t("From {percent} %", { percent: Math.round(current * 100) });
  const options = [...OPTIONS.map((o) => ({ value: o.value, label: t(o.label) })), ...(known ? [] : [{ value: current, label: custom }])]
    .sort((a, b) => a.value - b.value)
    .map((o) => ({ value: String(o.value), label: o.label }));
  return (
    <ValueRow
      label={t("File automatically")}
      help={t("Kortex files new entries itself when it is sure; unsure ones wait for you in the Inbox")}
      icon="inbox"
      value={known ? t(known.label).split(" (")[0] : custom}
      options={options}
      selected={String(current)}
      onSelect={(v) => updateUserSettings({ auto_place_threshold: Number(v) })}
    />
  );
}
