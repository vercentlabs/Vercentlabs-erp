import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const themePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "../tokens/theme.json");

export const theme = JSON.parse(readFileSync(themePath, "utf8"));
