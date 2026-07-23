import {
  createContext,
  useContext,
  useMemo,
  type PropsWithChildren,
} from "react";
import { palette, radii, spacing, typeScale } from "./tokens";

const lightColors = {
  canvas: palette.canvas,
  surface: palette.white,
  surfaceRaised: palette.white,
  text: palette.slate900,
  textSecondary: palette.slate700,
  textMuted: palette.slate500,
  border: palette.slate200,
  primary: palette.indigo600,
  primaryPressed: palette.indigo700,
  primarySoft: palette.indigo50,
  accent: palette.cyan600,
  inverse: palette.white,
  navigation: palette.navy900,
  success: palette.success700,
  successSoft: palette.success50,
  warning: palette.warning700,
  warningSoft: palette.warning50,
  danger: palette.danger700,
  dangerSoft: palette.danger50,
};

type ThemeColors = { [Key in keyof typeof lightColors]: string };

export type VercentTheme = {
  dark: boolean;
  colors: ThemeColors;
  spacing: typeof spacing;
  radii: typeof radii;
  type: typeof typeScale;
};

const ThemeContext = createContext<VercentTheme | null>(null);

export function ThemeProvider({ children }: PropsWithChildren) {
  const value = useMemo<VercentTheme>(
    () => ({
      // apps/web explicitly uses color-scheme: light. Keep the native shell on
      // the same palette so screenshots and learned visual cues stay aligned.
      dark: false,
      colors: lightColors,
      spacing,
      radii,
      type: typeScale,
    }),
    [],
  );
  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error("useTheme must be used inside ThemeProvider.");
  return theme;
}
