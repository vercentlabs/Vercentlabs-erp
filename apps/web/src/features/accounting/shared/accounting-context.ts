import "server-only";

import type { WorkspaceSessionContext } from "@/core/session";

export function accountingContext(session: WorkspaceSessionContext) {
  const raw = session as unknown as Record<string, unknown>;
  return {
    organizationId: session.organizationId,
    userId: String(raw.userId),
    permissions: (raw.permissions as string[] | undefined) ?? [],
    roleSlugs: (raw.roleSlugs as string[] | undefined) ?? [],
  };
}
