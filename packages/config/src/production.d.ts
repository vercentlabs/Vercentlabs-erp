// Server-only (reads mounted secret files with node:fs): import from
// "@vercentlabs/config/production", never from the browser-safe index.
export const SECRET_ENV_KEYS: readonly string[];
export function loadSecretFiles<T extends Record<string, string | undefined>>(environment?: T, readFile?: (path: string) => string): T;
export function validateRuntimeEnvironment(target: "web" | "worker" | "landing" | "migration", environment?: Record<string, string | undefined>): Readonly<Record<string, any>>;
