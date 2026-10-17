import { getTimeBillingSettings, saveTimeBillingSettings } from "@vercentlabs/api";
import { z } from "zod";

import { projectsMutation, projectsRead } from "@/features/projects/shared/route-helpers";

// The company's time-billing defaults.
const schema = z.object({ defaultMethod: z.string().max(40).optional(), reasonRequired: z.boolean().optional(), requestApproval: z.boolean().optional() });
export async function GET(request: Request) {
  return projectsRead(request, async (client, context) => ({ settings: await getTimeBillingSettings(client, context) }));
}
export async function POST(request: Request) {
  return projectsMutation(request, schema, async (client, context, input) => ({ settings: await saveTimeBillingSettings(client, context, input) }));
}
