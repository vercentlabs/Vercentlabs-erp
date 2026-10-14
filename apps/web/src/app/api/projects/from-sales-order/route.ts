import { createProjectFromSalesOrder } from "@vercentlabs/api";
import { z } from "zod";

import { projectsMutation } from "@/features/projects/shared/route-helpers";

// A project from a confirmed sales order — once; a further project for the same order only when asked for (with its own request key).
const schema = z.object({ salesOrderId: z.string().uuid(), additional: z.boolean().optional(), idempotencyKey: z.string().trim().min(1).max(160).optional(),
  name: z.string().max(200).optional(), managerUserId: z.string().uuid().optional(), projectTypeId: z.string().uuid().optional(), lineIds: z.array(z.string().uuid()).max(200).optional() });
export async function POST(request: Request) {
  return projectsMutation(request, schema, async (client, context, { salesOrderId, ...input }) => createProjectFromSalesOrder(client, context, salesOrderId, input), 201, "projects.create");
}
