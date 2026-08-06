type ClassValue = string | number | null | undefined | false | Record<string, boolean | undefined>;

/**
 * Minimal className combiner. Deliberately not a dependency (clsx/cn packages) —
 * this is the entire implementation those packages need for our use case, and the
 * repository's performance constraints call for avoiding unnecessary dependencies.
 */
export function cx(...values: ClassValue[]): string {
  const classes: string[] = [];
  for (const value of values) {
    if (!value) continue;
    if (typeof value === "string" || typeof value === "number") {
      classes.push(String(value));
      continue;
    }
    for (const [key, enabled] of Object.entries(value)) {
      if (enabled) classes.push(key);
    }
  }
  return classes.join(" ");
}
