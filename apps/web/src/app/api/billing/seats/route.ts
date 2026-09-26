import { z } from "zod";

import { changeSubscriptionSeats } from "@vercentlabs/api";
import { BILLING_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { billingProvider } from "@/features/billing/provider";

const schema = z.object({ users: z.number().int().min(1).max(500) });

export async function POST(request: Request) {
  return workspaceRoute(
    request,
    { permission: BILLING_PERMISSIONS.manage, transaction: "none", action: "billing.seats.change", auditDenial: true },
    async ({ client, session }) => {
      const body = schema.parse(await readJson(request));
      const ctx = { organizationId: session.organizationId, userId: session.userId, email: session.email };
      return ok(await changeSubscriptionSeats(client, ctx, body, billingProvider()));
    },
  );
}
