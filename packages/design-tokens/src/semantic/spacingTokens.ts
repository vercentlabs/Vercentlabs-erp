import { spacing } from "../primitives/spacing.ts";

/**
 * The raw 4px-grid steps already are the semantic scale — no arbitrary
 * spacing. This module exists so component code imports spacing from the
 * semantic layer consistently alongside colorTokens/typographyTokens,
 * rather than reaching into primitives directly.
 */
export const gap = spacing;
