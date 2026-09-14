import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

// Standard shadcn-style class combinator: clsx resolves conditional
// classes, tailwind-merge resolves conflicting Tailwind utility classes
// (e.g. a caller passing className="p-2" against a component default of
// "p-4" keeps the caller's p-2, not both).
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
