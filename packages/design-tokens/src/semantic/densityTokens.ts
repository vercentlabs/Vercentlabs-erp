import { spacing } from "../primitives/spacing.ts";
import { controlHeight } from "./controlTokens.ts";

/**
 * The two supported density modes. Components read `density[mode]` rather
 * than reimplementing compact/comfortable math themselves.
 */
export const density = {
  compact: {
    controlHeight: controlHeight.compact,
    rowPaddingY: spacing["2"],
    gap: spacing["2"],
  },
  comfortable: {
    controlHeight: controlHeight.comfortable,
    rowPaddingY: spacing["3"],
    gap: spacing["3"],
  },
} as const;

export type Density = keyof typeof density;
export const DEFAULT_DENSITY: Density = "comfortable";
