import type { ReactNode } from "react";

const SPECIAL: Record<string, string> = { in_app: "In app", whatsapp: "WhatsApp", sms: "SMS", not_reviewed: "Not reviewed" };

// A stored token such as "not_reviewed" or "in_app" is never product copy. Plain strings that look like a token are
// translated; anything else (already a sentence, an element, a name) is left exactly as given.
export function humanizeToken(children: ReactNode): ReactNode {
  if (typeof children !== "string" || !/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(children)) return children;
  if (SPECIAL[children]) return SPECIAL[children];
  const spaced = children.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
