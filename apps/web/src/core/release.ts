import { releaseContext as buildReleaseContext } from "@vercentlabs/api";
import type { SessionContext } from "@/core/auth";

export function releaseGovernanceContext(session: SessionContext) {
  return buildReleaseContext(session as unknown as Record<string, unknown>);
}
