import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useColorScheme } from "react-native";
import { createTheme, type Theme, type ThemeName } from "./tokens";

const Ctx = createContext<Theme>(createTheme("dark"));

/** `pref`: 0 = follow the system, 1 = light, 2 = dark (prototype "Erscheinungsbild"). */
export function ThemeProvider({ pref, accent, children }: { pref: number; accent: string; children: ReactNode }) {
  const system = useColorScheme();
  const name: ThemeName = pref === 1 ? "light" : pref === 2 ? "dark" : system === "light" ? "light" : "dark";
  const theme = useMemo(() => createTheme(name, accent), [name, accent]);
  return <Ctx.Provider value={theme}>{children}</Ctx.Provider>;
}

export const useTheme = (): Theme => useContext(Ctx);
