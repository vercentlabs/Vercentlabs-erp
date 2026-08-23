import { getProjectsDashboard } from "@vercentlabs/api";

import AccessDenied from "@/shared/components/access-denied";
import ProjectsDashboard from "@/modules/projects/components/projects-dashboard";
import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import { projectsContext } from "@/modules/projects";

export const metadata = { title: "Projects" };
export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.projectsView)) {
    return <AccessDenied area="Projects" />;
  }
  const summary = await tenantTransaction(session.organizationId, (client) =>
    getProjectsDashboard(client, projectsContext(session)),
  );
  return <ProjectsDashboard summary={summary} />;
}
