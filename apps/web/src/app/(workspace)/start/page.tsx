import { redirect } from "next/navigation";

import { startingModule } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { landingFor } from "@/shell/navigation/app-landing";
import { MODULE_NAVIGATION } from "@/shell/navigation/module-navigation-registry";
import { resolveWorkspaceContext } from "@/shell/workspace-context/resolveWorkspaceContext";

// Where signing in, setting up a workspace and joining a team land: the app used last (when it is still theirs), else the first app
// chosen at signup, else the first app they may open — its main screen, not a home or setup page.
export default async function StartPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const { session, accessibleModules } = await resolveWorkspaceContext();
  const usable = new Set(accessibleModules.filter((m) => m.accessible).map((m) => m.moduleId));
  const ordered = MODULE_NAVIGATION.map((m) => m.moduleKey).filter((key) => usable.has(key));
  const moduleKey = await tenantTransaction(session.organizationId, (client) => startingModule(client, session, ordered));
  const welcomeBack = (await searchParams).welcome === "back";
  redirect(moduleKey ? `${landingFor(moduleKey)}${welcomeBack ? "?welcome=back" : ""}` : "/");
}
