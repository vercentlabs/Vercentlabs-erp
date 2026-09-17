import { focus } from "./colorTokens.ts";
import { motion } from "../primitives/motion.ts";

/** Cross-cutting interaction-state values shared by every interactive
 * component, so hover/disabled/focus behavior stays consistent without
 * each component re-deriving it. */
export const state = {
  disabledOpacity: 0.5,
  focusRing: {
    color: focus.ring,
    width: 2,
    offset: 2,
  },
  transitionDuration: motion.fast,
} as const;
