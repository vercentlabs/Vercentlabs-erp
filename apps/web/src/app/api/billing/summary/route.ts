import { getBillingOverview } from "@vercentlabs/api";

import { BILLING_PERMISSIONS, billingRead } from "@/features/billing/server";

export async function GET() {
  return billingRead(BILLING_PERMISSIONS.view, async (client, session) => ({ overview: await getBillingOverview(client, session.organizationId, process.env) }));
}
