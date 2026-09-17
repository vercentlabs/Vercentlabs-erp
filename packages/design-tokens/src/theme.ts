import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export interface VercentlabsTheme {
  version: string;
  font: { sans: string };
  color: Record<string, string>;
  alpha: Record<string, string>;
  spacing: Record<string, number>;
  radius: Record<string, number>;
  control: Record<string, number>;
  layout: Record<string, number>;
  breakpoint: Record<string, number>;
  z: Record<string, number>;
  motion: Record<string, number>;
  webType: Record<string, number>;
  nativeType: Record<string, [number, number, number]>;
}

const themePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "../tokens/theme.json");

/** The raw token source (packages/design-tokens/tokens/theme.json). Prefer
 * the primitive/semantic modules over reaching into this directly. */
export const theme: VercentlabsTheme = JSON.parse(readFileSync(themePath, "utf8"));
