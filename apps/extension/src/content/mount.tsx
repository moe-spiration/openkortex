import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ContentScriptContext } from "wxt/utils/content-script-context";
import { createShadowRootUi } from "wxt/utils/content-script-ui/shadow-root";
import type { LookSetting, ThemeSetting } from "../lib/settings";
import { ThemeRoot } from "../ui/ThemeRoot";

export interface MountedUi {
  host: HTMLElement;
  remove(): void;
}

/**
 * Renders React into a closed-off shadow root (the page's CSS cannot reach in, ours cannot leak out).
 * The host carries `data-kortex-ui` so highlight offsets and chat export ignore it.
 */
export async function mountReact(
  ctx: ContentScriptContext,
  opts: {
    name: string;
    theme: ThemeSetting;
    look?: LookSetting;
    node: ReactNode;
    position: "inline" | "overlay";
    anchor?: string | Element;
    append?: "first" | "last" | "before" | "after";
    zIndex?: number;
  },
): Promise<MountedUi> {
  const ui = await createShadowRootUi<Root>(ctx, {
    name: opts.name,
    position: opts.position,
    anchor: opts.anchor ?? "body",
    append: opts.append ?? "last",
    zIndex: opts.zIndex ?? 2147483646,
    onMount: (container) => {
      const root = createRoot(container);
      root.render(<ThemeRoot theme={opts.theme} look={opts.look}>{opts.node}</ThemeRoot>);
      return root;
    },
    onRemove: (root) => root?.unmount(),
  });
  ui.shadowHost.setAttribute("data-kortex-ui", "");
  ui.mount();
  return { host: ui.shadowHost, remove: () => ui.remove() };
}
