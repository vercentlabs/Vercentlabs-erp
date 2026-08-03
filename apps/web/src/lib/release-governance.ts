import { releaseContext as buildReleaseContext } from "@vercentlabs/api";
import type { SessionContext } from "@/lib/auth";

export function releaseGovernanceContext(session: SessionContext) {
  return buildReleaseContext(session as unknown as Record<string, unknown>);
}
