import { z } from "zod";

import { saveBillingProfile } from "@vercentlabs/api";
import { BILLING_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

const text = (max: number) => z.string().trim().max(max).optional().default("");
const schema = z.object({
  legalName: z.string().trim().min(1).max(200),
  billingEmail: z.string().trim().max(320),
  phone: text(30),
  gstin: text(15),
  addressLine1: text(200),
  addressLine2: text(200),
  city: text(100),
  state: text(100),
  postalCode: text(20),
  country: text(2),
});

// Validation and audit happen in saveBillingProfile, inside this platform transaction.
export async function PATCH(request: Request) {
  return workspaceRoute(
    request,
    { permission: BILLING_PERMISSIONS.manage, action: "billing.profile.update", transaction: "platform", auditDenial: true },
    async ({ client, session }) => {
      const body = schema.parse(await readJson(request));
      const profile = await saveBillingProfile(client, { organizationId: session.organizationId, userId: session.userId }, body);
      return ok({ profile, message: "Billing details saved." });
    },
  );
}
