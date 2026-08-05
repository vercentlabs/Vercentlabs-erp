import { getProjectsDashboard } from "@vercentlabs/api";

import AccessDenied from "@/components/access-denied";
import ProjectsDashboard from "@/components/projects/projects-dashboard";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { tenantTransaction } from "@/lib/db";
import { projectsContext } from "@/lib/projects";

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
