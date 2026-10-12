import { z } from "zod";

import { quickCreatePosCustomer, searchPointOfSaleCustomers } from "@vercentlabs/api";

import { posMutation, posRead } from "@/features/pos/shared/route-helpers";

// Customer search for the counter (CUSTOMER_SELECT): name, customer number, phone, email or GSTIN, ranked and paged.
export async function GET(request: Request) {
  const url = new URL(request.url);
  return posRead(request, async (client, context) => searchPointOfSaleCustomers(client, context, {
    query: url.searchParams.get("q") ?? "",
    cartId: url.searchParams.get("cartId"),
    limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
    offset: url.searchParams.get("offset") ? Number(url.searchParams.get("offset")) : undefined,
  }), "pos.view");
}

const optionalText = (max: number) => z.string().trim().max(max).optional().nullable();

// A customer created at the counter (CUSTOMER_QUICK_CREATE) — in the shared Customer Master, with its validation and duplicate check.
export async function POST(request: Request) {
  const schema = z.object({
    kind: z.enum(["individual", "business"]).optional(),
    name: z.string().trim().min(1).max(200),
    legalName: optionalText(200),
    phone: optionalText(30),
    email: optionalText(200),
    gstin: optionalText(15),
    billingAddress: z.object({
      line1: optionalText(200), line2: optionalText(200), city: optionalText(100), stateCode: optionalText(2), postalCode: optionalText(10),
    }).optional().nullable(),
    contactPerson: optionalText(120),
    notes: optionalText(1000),
    cartId: z.string().uuid().optional().nullable(),
    idempotencyKey: z.string().min(8).max(200),
    confirmNotDuplicate: z.boolean().optional(),
    duplicateReason: optionalText(500),
  });
  return posMutation(request, schema, async (client, context, input) => quickCreatePosCustomer(client, context, input), 201, "pos.view");
}
