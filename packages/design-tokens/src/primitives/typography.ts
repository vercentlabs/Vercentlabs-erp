import { theme } from "../theme.ts";

/** Web font stack. next/font/google owns the actual runtime loading in
 * apps/web (see apps/web/src/app/layout.tsx) — this is the documented
 * intended family for non-web consumers (Storybook docs, design specs). */
export const fontFamily = theme.font.sans;

/** Raw web type-size scale, in px. See semantic/typographyTokens.ts for
 * which size to use where. */
export const fontSize = theme.webType;

/** Raw native (React Native) type scale: [fontSize, lineHeight, fontWeight]. */
export const nativeTypeScale = theme.nativeType;
