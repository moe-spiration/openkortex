import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { GestureLayer } from "@/components/motion/GestureLayer";
import { NotesProvider } from "@/lib/notes/store";
import { SettingsProvider } from "@/lib/settings/store";
import { ShellProvider } from "@/lib/shell/store";
import { ThemePackProvider } from "@/lib/theme/pack";
import { LiveData } from "@/lib/supabase/LiveData";
import { loadWorkspace } from "@/lib/supabase/workspace";

// Per-user data (cookie session): never prerender the workspace at build time.
export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  // Live mode: the signed-in user's snapshot (null with KORTEX_DATA_SOURCE=mock).
  const snapshot = await loadWorkspace();
  return (
    <LiveData snapshot={snapshot}>
      <ShellProvider>
        <SettingsProvider>
          <ThemePackProvider>
            <NotesProvider>
              <AppShell>{children}</AppShell>
              <GestureLayer />
            </NotesProvider>
          </ThemePackProvider>
        </SettingsProvider>
      </ShellProvider>
    </LiveData>
  );
}
