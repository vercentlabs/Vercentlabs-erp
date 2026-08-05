import { stockContext as buildContext } from "@vercentlabs/api";
import type { SessionContext } from "@/lib/auth";
export function stockContext(session: SessionContext) {
  return buildContext(session as unknown as Record<string, unknown>);
}
