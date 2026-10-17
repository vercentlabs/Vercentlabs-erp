import { createProjectTimeEntry, listTimeEntries } from "@vercentlabs/api";
import { z } from "zod";

import { projectsMutation, projectsRead } from "@/features/projects/shared/route-helpers";

// Projects — Timesheets: the time entries a person may see (?view=mine | team | all, with filters), and recording time (the employee is the
// signed-in person unless a project manager records for a team member).
const pick = (url: URL, keys: string[]) => Object.fromEntries(keys.map((key) => [key, url.searchParams.get(key) ?? undefined]).filter(([, value]) => value !== undefined && value !== ""));
const schema = z.object({ projectId: z.string().max(64).optional(), taskId: z.string().uuid().nullable().optional(), workDate: z.string().max(10).optional(), durationMinutes: z.number().optional(), hours: z.number().optional(), minutes: z.number().optional(), startTime: z.string().max(5).nullable().optional(), endTime: z.string().max(5).nullable().optional(), description: z.string().max(2000).optional(), billable: z.boolean().nullable().optional(), employeeUserId: z.string().uuid().optional(), contractLineId: z.string().uuid().optional(), billingReasonCode: z.string().max(40).nullable().optional(), billingReasonNote: z.string().max(500).nullable().optional(), classificationReason: z.string().max(500).optional(), idempotencyKey: z.string().trim().min(1).max(200).optional() });
export async function GET(request: Request) {
  return projectsRead(request, async (client, context, url) => listTimeEntries(client, context, pick(url, ["view", "from", "to", "projectId", "taskId", "employeeId", "status", "billable", "flagged", "search", "sort", "direction", "page", "pageSize"])));
}
export async function POST(request: Request) {
  return projectsMutation(request, schema, async (client, context, input) => createProjectTimeEntry(client, context, input), 201);
}
