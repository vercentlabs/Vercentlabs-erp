import { createProjectExpense, listProjectExpenses } from "@vercentlabs/api";
import { z } from "zod";

import { projectsMutation, projectsRead } from "@/features/projects/shared/route-helpers";

// Project expenses: GET a queue (?view=mine | team | approvals | finance | reimbursements | corrections | billing | all, projectId, status, categoryId,
// claimantId, from, to, source, search, sort, direction, page, pageSize) · POST a new claim (the claimant and company come from the session).
const KEYS = ["view", "projectId", "status", "categoryId", "claimantId", "from", "to", "source", "search", "sort", "direction", "page", "pageSize"];
export async function GET(request: Request) {
  return projectsRead(request, async (client, context, url) => listProjectExpenses(client, context,
    Object.fromEntries(KEYS.map((key) => [key, url.searchParams.get(key) ?? undefined]).filter(([, value]) => value !== undefined && value !== ""))));
}
export async function POST(request: Request) {
  return projectsMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => createProjectExpense(client, context, input), 201);
}
