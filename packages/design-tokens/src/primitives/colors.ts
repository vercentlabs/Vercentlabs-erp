import { theme } from "../theme.ts";

/** Raw brand palette — approved Vercentlabs values. Do not edit here; edit
 * tokens/theme.json and regenerate (`pnpm design:generate` at repo root). */
export const colors = theme.color;

/** Raw alpha/overlay values (shadows, focus glow, backdrops). */
export const alpha = theme.alpha;

/** Data-visualisation slots (series order + record states). Charts read
 * them as CSS variables (--color-chart-*); see generate-tailwind-theme.mjs. */
export const chartColors = theme.chart;
