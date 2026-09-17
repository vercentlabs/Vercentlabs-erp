import { twMerge } from "tailwind-merge";

type ClassValue = string | number | null | undefined | false | Record<string, boolean | null | undefined>;

function join(inputs: ClassValue[]): string {
  const out: string[] = [];
  for (const input of inputs) {
    if (!input) continue;
    if (typeof input === "string" || typeof input === "number") {
      out.push(String(input));
    } else {
      for (const key in input) if (input[key]) out.push(key);
    }
  }
  return out.join(" ");
}

/** Combine conditional classNames, then let tailwind-merge resolve
 * conflicting utilities (last one wins) so callers can safely override a
 * component's default classes without !important fights. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(join(inputs));
}
