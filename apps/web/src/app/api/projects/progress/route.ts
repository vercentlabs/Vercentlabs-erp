import { getPortfolioProgress } from "@vercentlabs/api";

import { listFilters, projectsRead } from "@/features/projects/shared/route-helpers";

// The portfolio: every visible project's task completion, required milestones, health and schedule, with two named aggregate measures.
// ?attention=1 keeps the projects needing attention (at risk, blocked or overdue).
export async function GET(request: Request) {
  return projectsRead(request, async (client, context, url) => getPortfolioProgress(client, context, { ...listFilters(url), attention: url.searchParams.get("attention") ?? undefined }));
}
