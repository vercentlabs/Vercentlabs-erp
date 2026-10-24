import { z } from "zod";

import { getCustomerPortal, setCustomerPortal } from "@vercentlabs/api";

import { salesMutation, salesRead } from "@/features/sales/shared/route-helpers";

// The customer portal's switch and address (Sales report Phase 3).
export async function GET(request: Request) {
  return salesRead(request, "sales.settings.manage", async (client, context) => getCustomerPortal(client, context));
}

// { on, newAddress? }
export async function PUT(request: Request) {
  return salesMutation(request, "sales.settings.manage", z.object({ on: z.boolean(), newAddress: z.boolean().optional() }),
    async (client, context, input) => setCustomerPortal(client, context, input));
}
