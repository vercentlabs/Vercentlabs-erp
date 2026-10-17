import { getEmployeeWeeklyTimesheet } from "@vercentlabs/api";

import { projectsRead } from "@/features/projects/shared/route-helpers";

// One person's week (?week= any day of it; ?employeeId= a team member, for those who see team time).
export async function GET(request: Request) {
  return projectsRead(request, async (client, context, url) => getEmployeeWeeklyTimesheet(client, context, { week: url.searchParams.get("week") ?? undefined, employeeUserId: url.searchParams.get("employeeId") ?? undefined }));
}
