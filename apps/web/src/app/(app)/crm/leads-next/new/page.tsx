import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCrmOptions } from "@vercentlabs/api";
import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { crmApiContext } from "@/modules/crm";
import { tenantTransaction } from "@/core/db";
import { LeadCreateForm } from "./LeadCreateForm";

// UI 2.0 golden reference: real Create surface (docs/ux/UI_REWRITE_TRACKER.md
// Phase 5), built on the RecordFormSurface archetype + the TanStack Form
// field system from Phase 3. Submits to the real, existing
// POST /api/crm/leads route (createCrmRecord under the hood) -- no new
// backend code, no bypassed domain validation.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "New lead" };

export default async function NewLeadPage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmLeadsManage)) notFound();
  const context = await crmApiContext(session);
  const options = await tenantTransaction(context.organizationId, (client) => getCrmOptions(client, context));

  return (
    <LeadCreateForm
      sources={JSON.parse(JSON.stringify(options.sources || []))}
      owners={JSON.parse(JSON.stringify(options.users || []))}
      currencies={JSON.parse(JSON.stringify(options.currencies || []))}
    />
  );
}
