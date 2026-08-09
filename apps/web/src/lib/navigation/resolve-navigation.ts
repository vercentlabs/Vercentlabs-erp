// Server-side navigation resolution — Part 9's "filter before render."
// Split into a pure function (filterNavigation, easily unit-testable with
// fixture data — no DB) and a thin async wrapper (resolveNavigation) that
// supplies the one real, DB/billing-backed input: getAccessibleModules(),
// Prompt 4/5's canonical resolver. Nothing here re-implements module
// enablement/entitlement/permission logic — it only consumes
// resolveModuleAccess's verdicts and apps/web's existing hasPermission().
import type { WorkspaceSessionContext, SessionContext } from "@/lib/auth";
import { hasPermission } from "@/lib/authorization";
import { getAccessibleModules } from "@/lib/module-access";
import { administrationNavigation, workspaceSettingsSection } from "@/lib/navigation/administration";
import { governanceNavigation } from "@/lib/navigation/governance";
import { moduleNavigation } from "@/lib/navigation/modules";
import { myWorkNavigation } from "@/lib/navigation/my-work";
import type {
  ModuleNavigationGroup,
  NavigationItem,
  ResolvedNavigation,
} from "@/lib/navigation/types";
import { workspaceNavigation } from "@/lib/navigation/workspace";

function visiblePermissionItems(
  session: SessionContext,
  items: NavigationItem[],
): NavigationItem[] {
  return items.filter((item) => !item.permission || hasPermission(session, item.permission));
}

export type NavigationAccessInput = {
  session: SessionContext;
  /** moduleId -> accessible, from getAccessibleModules(). A module absent from this set is treated as inaccessible (fail closed). */
  accessibleModuleIds: ReadonlySet<string>;
};

// workspaceSettingsSection is rendered as its own collapsible group (like a
// module section), not a flat item list — kept out of `administration` so
// AppShell doesn't have to special-case "the one non-module group with
// nested items" inside a flat array.
export type ResolvedNavigationWithSettings = ResolvedNavigation & {
  workspaceSettings: { id: string; label: string; items: NavigationItem[] };
};

// Pure — no I/O. accessibleModuleIds is expected to already reflect
// resolveModuleAccess's full released/enabled/entitled/permitted chain; this
// function does not re-derive any of that, it only removes what isn't
// accessible and prunes what's left empty.
export function filterNavigation({
  session,
  accessibleModuleIds,
}: NavigationAccessInput): ResolvedNavigationWithSettings {
  const modules: ModuleNavigationGroup[] = moduleNavigation
    .filter((group) => accessibleModuleIds.has(group.moduleId))
    .map((group) => ({ ...group, items: visiblePermissionItems(session, group.items) }))
    .filter((group) => group.items.length > 0);

  const settingsItems = visiblePermissionItems(session, workspaceSettingsSection.items);

  return {
    workspace: visiblePermissionItems(session, workspaceNavigation),
    modules,
    myWork: visiblePermissionItems(session, myWorkNavigation),
    governance: visiblePermissionItems(session, governanceNavigation),
    administration: visiblePermissionItems(session, administrationNavigation),
    workspaceSettings: { ...workspaceSettingsSection, items: settingsItems },
  };
}

export async function resolveNavigation(
  session: WorkspaceSessionContext,
): Promise<ResolvedNavigationWithSettings> {
  let accessibleModuleIds: ReadonlySet<string>;
  try {
    const access = await getAccessibleModules(session);
    accessibleModuleIds = new Set(
      access.filter((entry) => entry.accessible).map((entry) => entry.moduleId),
    );
  } catch {
    // Fail closed: a lookup failure hides every module rather than showing
    // all of them (mirrors resolveModuleAccess's own fail-closed contract).
    accessibleModuleIds = new Set();
  }

  return filterNavigation({ session, accessibleModuleIds });
}
