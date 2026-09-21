import { z } from "zod";

import { saveBillingProfile } from "@vercentlabs/api";

import { BILLING_PERMISSIONS, billingWrite } from "@/features/billing/server";

const text = (max: number) => z.string().trim().max(max).optional().default("");
const schema = z.object({
  legalName: z.string().trim().min(1).max(200),
  billingEmail: z.string().trim().max(320),
  phone: text(30), gstin: text(15), addressLine1: text(200), city: text(100), state: text(100), postalCode: text(20), country: text(2),
});

export async function PATCH(request: Request) {
  return billingWrite(request, BILLING_PERMISSIONS.manage, (body) => schema.parse(body), async (client, session, input) => ({
    profile: await saveBillingProfile(client, { organizationId: session.organizationId, userId: session.userId }, input),
    message: "Billing details saved.",
  }));
}
