import { z } from "zod";

import { quickCreatePosCustomer, searchPointOfSaleCustomers } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

import { ok } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

export async function GET(request: Request) {
  return workspaceRoute(
    request,
    { module: "point-of-sale" },
    async ({ client, session }) => {
      const url = new URL(request.url);
      const query = url.searchParams.get("q") || "";
      const limit = url.searchParams.get("limit");
      const offset = url.searchParams.get("offset");
      const rows = await searchPointOfSaleCustomers(
        client,
        posContext(session),
        {
          query,
          limit: limit ? Number(limit) : undefined,
          offset: offset ? Number(offset) : undefined,
        },
      );
      return ok({ rows });
    },
  );
}

// A customer created at the counter (CUSTOMER_QUICK_CREATE) — in the shared Customer Master, with its validation and duplicate check.
export async function POST(request: Request) {
  const schema = z.object({
    name: z.string().trim().min(1).max(200),
    phone: z.string().trim().max(30).optional().nullable(),
    email: z.string().trim().max(200).optional().nullable(),
    gstin: z.string().trim().max(15).optional().nullable(),
    cartId: z.string().uuid().optional().nullable(),
  });
  return posMutation(request, schema, async (client, context, input) => ({ customer: await quickCreatePosCustomer(client, context, input) }), 201, "pos.view");
}
