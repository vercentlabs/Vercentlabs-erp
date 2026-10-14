import { listOverheadCategories, listOverheadPoolAccounts, saveOverheadCategory } from "@vercentlabs/api";
import { z } from "zod";

import { manufacturingMutation, manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// The overhead categories (each a cost pool of the company's expense accounts) and the accounts a pool can be made of.
export async function GET(request: Request) {
  return manufacturingRead(request, async (client, context) => ({ categories: await listOverheadCategories(client, context), accounts: await listOverheadPoolAccounts(client, context) }));
}

const schema = z.object({
  id: z.string().uuid().optional(), code: z.string().max(40).optional(), name: z.string().min(1).max(200), description: z.string().max(1000).nullable().optional(),
  defaultBasis: z.enum(["PER_GOOD_UNIT", "PER_BATCH"]).optional(), costPoolAccountIds: z.array(z.string().uuid()).max(50).optional(), costPoolNote: z.string().max(1000).nullable().optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});
export async function POST(request: Request) {
  return manufacturingMutation(request, schema, async (client, context, input) => saveOverheadCategory(client, context, input));
}
