// Server-side Quick Create filtering (Part 10 security requirement: "If
// user cannot create purchase orders: do not display Create Purchase
// Order"). Resolved once per request in apps/web/src/app/(app)/layout.tsx,
// alongside resolveNavigation() — reuses the same cached
// getAccessibleModules() call (Part 27), so this adds no extra DB round
// trip beyond what navigation resolution already makes.
import type { WorkspaceSessionContext } from "@/core/auth";
import { hasPermission } from "@/core/authorization";
import { getAccessibleModules } from "@/core/module-access";
import { quickCreateActions, type QuickCreateAction } from "@/core/quick-create/actions";

export async function resolveQuickCreate(
  session: WorkspaceSessionContext,
): Promise<QuickCreateAction[]> {
  let accessibleModuleIds: ReadonlySet<string>;
  try {
    const access = await getAccessibleModules(session);
    accessibleModuleIds = new Set(access.filter((entry) => entry.accessible).map((entry) => entry.moduleId));
  } catch {
    // Fail closed — same contract as resolveNavigation's own catch.
    accessibleModuleIds = new Set();
  }

  return quickCreateActions.filter(
    (action) =>
      accessibleModuleIds.has(action.moduleId) &&
      (!action.permission || hasPermission(session, action.permission)),
  );
}
