import { theme } from "../theme.ts";

/** Motion durations, in ms. Motion communicates state change; it must
 * never be the only signal, and must respect prefers-reduced-motion. */
export const motion = {
  fast: theme.motion.fast,
  standard: theme.motion.standard,
} as const;
