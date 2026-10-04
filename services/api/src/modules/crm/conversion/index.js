// Lead-to-Opportunity Conversion: one governed operation that turns a
// qualified lead into its account, contact and opportunity.
export { CONVERSION_PERMISSIONS } from "./constants.js";
export { conversionCapabilities } from "./access.js";
export { previewLeadConversion } from "./preview.js";
export { convertLead } from "./convert.js";
export { getLeadConversionMetrics } from "./metrics.js";

import { readConversionByLead, toConversion } from "./records.js";
import { getLead } from "../leads/records.js";

// The conversion record of a converted lead the caller can see, or null.
export async function getLeadConversion(client, context, leadId) {
  const lead = await getLead(client, context, leadId);
  const row = await readConversionByLead(client, context, lead.id);
  return row ? toConversion(row) : null;
}
