import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useColorScheme } from "react-native";
import { createTheme, type Look, type Theme, type ThemeName } from "./tokens";

const Ctx = createContext<Theme>(createTheme("dark"));

/** `pref`: 0 = follow the system, 1 = light, 2 = dark (prototype "Erscheinungsbild"). */
export function ThemeProvider({ pref, accent, look = "ruhe", children }: { pref: number; accent: string; look?: Look; children: ReactNode }) {
  const system = useColorScheme();
  const name: ThemeName = pref === 1 ? "light" : pref === 2 ? "dark" : system === "light" ? "light" : "dark";
  const theme = useMemo(() => createTheme(name, accent, look), [name, accent, look]);
  return <Ctx.Provider value={theme}>{children}</Ctx.Provider>;
}

export const useTheme = (): Theme => useContext(Ctx);

/** True when the device look is Ruhe (see tokens `Look`). */
export const useRuhe = (): boolean => useContext(Ctx).look === "ruhe";
