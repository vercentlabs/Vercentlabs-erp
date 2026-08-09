import type { ReactNode } from "react";

import ModuleAccessDenied from "@/components/module-access-denied";
import { requireWorkspace } from "@/lib/auth";
import { resolveModuleAccess } from "@/lib/module-access";
import type { ModuleId } from "@/lib/navigation/types";

// Closes Prompt 5's documented remaining gap: server-rendered module pages
// could previously be reached directly by URL with no module-enablement/
// entitlement check (only the page's own hasPermission() gate, unrelated to
// module access). One of these per module route root — not one check per
// page.tsx — is the "narrowest shared layout boundary" Part 10 asks for.
// requireWorkspace() (unchanged, existing) already redirects unauthenticated
// or unverified users before this component runs; module-access.ts's own
// fail-closed contract (Prompt 4) means a lookup failure here denies
// access, it never falls open.
export default async function ModulePageGuard({
  moduleId,
  children,
}: {
  moduleId: ModuleId;
  children: ReactNode;
}) {
  const session = await requireWorkspace();
  const access = await resolveModuleAccess(session, moduleId);
  if (!access.accessible) {
    return <ModuleAccessDenied moduleName={access.name} reason={access.reason ?? "not_permitted"} />;
  }
  return <>{children}</>;
}
