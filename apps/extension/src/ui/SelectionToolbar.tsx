import type { CSSProperties } from "react";
import { Eraser, Highlighter, Sparkles } from "lucide-react";
import { Button } from "@kortex/ui";
import { t } from "../i18n";

// bundle.css `.kx-seltool .kx-btn--ghost`: 28px high (36px touch target), 12px text, 8px radius
const ITEM = "h-7 min-h-9 rounded-lg px-2 text-xs";

export interface SelectionToolbarProps {
  onHighlight: () => void;
  /** The "Ask AI" action is only rendered when wired (needs the Kortex copilot deep link). */
  onAskAi?: () => void;
  style?: CSSProperties;
}

/** Floating mini menu over a text selection (Extension.dc.html "Inline-Highlighter"). */
export function SelectionToolbar({ onHighlight, onAskAi, style }: SelectionToolbarProps) {
  return (
    <div
      className="kx-seltool kx-slide-up"
      role="toolbar"
      aria-label={t("Selection")}
      style={style}
      // keep the page selection alive while the toolbar is used
      onMouseDown={(e) => e.preventDefault()}
    >
      <Button variant="ghost" className={ITEM} onClick={onHighlight}>
        <Highlighter />
        {t("Save highlight to Kortex")}
      </Button>
      {onAskAi && (
        <Button variant="ghost" className={ITEM} onClick={onAskAi}>
          <Sparkles className="text-ai" />
          {t("Ask AI")}
        </Button>
      )}
    </div>
  );
}

/** Shown when a saved highlight is clicked: removes it from the page and from Kortex. */
export function MarkToolbar({ onRemove, style }: { onRemove: () => void; style?: CSSProperties }) {
  return (
    <div className="kx-seltool kx-slide-up" role="toolbar" aria-label="Highlight" style={style} onMouseDown={(e) => e.preventDefault()}>
      <Button variant="ghost" className={ITEM} onClick={onRemove}>
        <Eraser />
        {t("Remove highlight")}
      </Button>
    </div>
  );
}
