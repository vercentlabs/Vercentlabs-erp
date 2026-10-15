import { getProjectSettings, saveProjectSettings } from "@vercentlabs/api";
import { z } from "zod";

import { projectsMutation, projectsRead } from "@/features/projects/shared/route-helpers";

// The company's project policy, types and roles.
export async function GET(request: Request) {
  return projectsRead(request, async (client, context) => getProjectSettings(client, context));
}
const schema = z.object({ activationApprovalRequired: z.boolean().optional(), selfApprovalAllowed: z.boolean().optional(), dueSoonDays: z.number().int().optional(),
  customerAcceptanceRequired: z.boolean().optional(), customerChangeApprovalRequired: z.boolean().optional(), primaryContactRequired: z.boolean().optional(),
  inactiveCustomerAllowed: z.boolean().optional(), milestoneSelfApprovalAllowed: z.boolean().optional(), milestoneInternalApprovalDefault: z.boolean().optional(),
  taskSelfReviewAllowed: z.boolean().optional(), taskReviewDefault: z.boolean().optional(), taskReminderDays: z.number().int().optional() });
export async function PUT(request: Request) {
  return projectsMutation(request, schema, async (client, context, input) => ({ settings: await saveProjectSettings(client, context, input) }), 200, "projects.settings.manage");
}
