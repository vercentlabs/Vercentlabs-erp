import { getExpenseSettings, saveExpenseSettings } from "@vercentlabs/api";
import { z } from "zod";

import { projectsMutation, projectsRead } from "@/features/projects/shared/route-helpers";

// The company's expense policy: Finance review, the receipt threshold, the manager's approval limit, the claim deadline.
export async function GET(request: Request) {
  return projectsRead(request, async (client, context) => ({ settings: await getExpenseSettings(client, context) }));
}
export async function POST(request: Request) {
  return projectsMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => ({ settings: await saveExpenseSettings(client, context, input) }));
}
