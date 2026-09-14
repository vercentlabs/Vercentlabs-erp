import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCrmOptions, getCrmRecord } from "@vercentlabs/api";
import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { crmApiContext } from "@/modules/crm";
import { tenantTransaction } from "@/core/db";
import { LeadEditForm } from "./LeadEditForm";

// UI 2.0 golden reference: real Edit surface (docs/ux/UI_REWRITE_TRACKER.md
// Phase 5). Submits to the real, existing PATCH /api/crm/leads/[id] route
// with the record's real `updatedAt` as `expectedUpdatedAt` for optimistic
// concurrency -- the same check the legacy resource-manager.tsx already
// relies on. Owner (ownerUserId) is deliberately NOT editable here: the
// PATCH route requires an ownerUserId change to be submitted alone
// ("Change the Lead owner separately from other Lead fields",
// CRM_LEAD_ASSIGNMENT_REQUIRED) and stage/status changes must go through
// the governed lifecycle transition action, not a plain PATCH
// (CRM_LEAD_STAGE_ACTION_REQUIRED) -- both real backend contracts, not
// arbitrary omissions.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Edit lead" };

export default async function EditLeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmLeadsManage)) notFound();
  const context = await crmApiContext(session);

  let lead;
  let options;
  try {
    [lead, options] = await tenantTransaction(context.organizationId, async (client) => [
      await getCrmRecord(client, context, "leads", id),
      await getCrmOptions(client, context),
    ]);
  } catch {
    notFound();
  }

  return (
    <LeadEditForm
      lead={JSON.parse(JSON.stringify(lead))}
      sources={JSON.parse(JSON.stringify(options.sources || []))}
      currencies={JSON.parse(JSON.stringify(options.currencies || []))}
    />
  );
}
