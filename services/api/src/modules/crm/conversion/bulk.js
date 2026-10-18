// Converting many leads at once (CRM plan 5.4). Each lead is converted exactly as Convert would with its suggested choices — the
// matching company and contact when one is found, else new ones; a deal named and valued from the lead — each on its own (one that
// cannot be converted is reported and the others go ahead). The deals can go to the leads' owners, to one person, or round-robin
// among several.
//
// input: { leadIds, expectedCloseDate (YYYY-MM-DD), owner?: { mode: "lead_owner" | "user" | "round_robin", userId?, userIds? },
//          pipelineId?, overrideReason? (converts leads that miss qualification requirements, with the override permission) }
import { CrmError } from "../data-management/errors.js";
import { convertLead } from "./convert.js";
import { previewLeadConversion } from "./preview.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIMIT = 100;

export async function bulkConvertLeads(client, context, input = {}) {
  const ids = [...new Set(Array.isArray(input.leadIds) ? input.leadIds.filter((id) => UUID.test(String(id))) : [])];
  if (!ids.length) throw new CrmError(400, "Select at least one lead.", "CRM_LEAD_VALIDATION");
  if (ids.length > LIMIT) throw new CrmError(400, `Convert up to ${LIMIT} leads at a time.`, "CRM_LEAD_BULK_LIMIT");
  const closeDate = String(input.expectedCloseDate ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(closeDate)) throw new CrmError(400, "Choose the expected close date for the deals.", "CRM_CONVERSION_VALIDATION");
  const mode = input.owner?.mode ?? "lead_owner";
  if (!["lead_owner", "user", "round_robin"].includes(mode)) throw new CrmError(400, "Choose who gets the deals.", "CRM_CONVERSION_VALIDATION");
  const owners = mode === "user" ? [input.owner.userId] : mode === "round_robin" ? [...new Set(input.owner.userIds ?? [])] : [];
  if (mode !== "lead_owner" && (!owners.length || owners.some((id) => !UUID.test(String(id)))))
    throw new CrmError(400, mode === "user" ? "Choose who gets the deals." : "Choose the people to share the deals between.", "CRM_CONVERSION_VALIDATION");

  const results = [];
  let turn = 0;
  for (const leadId of ids) {
    await client.query("SAVEPOINT lead_bulk_conversion");
    try {
      const preview = await previewLeadConversion(client, context, leadId);
      const ownerUserId = mode === "lead_owner" ? undefined : owners[turn % owners.length];
      const done = await convertLead(client, context, leadId, {
        account: preview.defaults.account, contact: preview.defaults.contact,
        opportunity: {
          ...preview.defaults.opportunity, expectedCloseDate: closeDate, acknowledgeMatches: true,
          ...(ownerUserId ? { ownerUserId } : {}), ...(input.pipelineId ? { pipelineId: input.pipelineId } : {}),
        },
        ...(input.overrideReason ? { overrideReason: String(input.overrideReason).slice(0, 500) } : {}),
        idempotencyKey: `bulk-convert:${leadId}`,
      });
      await client.query("RELEASE SAVEPOINT lead_bulk_conversion");
      if (ownerUserId) turn += 1;
      results.push({ leadId, ok: true, opportunityId: done.opportunityId ?? done.opportunity?.id ?? null });
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT lead_bulk_conversion");
      if (!(error instanceof CrmError)) throw error;
      results.push({ leadId, ok: false, message: error.message, code: error.code });
    }
  }
  return { results, succeeded: results.filter((entry) => entry.ok).length, failed: results.filter((entry) => !entry.ok).length };
}
