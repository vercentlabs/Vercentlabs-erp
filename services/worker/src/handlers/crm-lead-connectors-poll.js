import { z } from "zod";
import { listDueLeadConnectors, pullLeadConnector } from "@vercentlabs/api/crm";

export const JOB_TYPE = "crm.lead_connectors.poll";

export const payloadSchema = z.object({}).strict();

// CRM plan 3.3: reads every due IndiaMART and TradeIndia connector of the organization (managed mode: the provider is called outside
// any transaction, then each connector's leads are written in their own). A connector whose provider fails records the error on itself
// and the others still run; each provider lead is kept once by its id, so a re-run never makes a second lead.
export async function pollLeadConnectorsHandler(_client, _systemContext, _payload, runtime) {
  const runTenant = (work) => runtime.withTenantClient(runtime.pool, runtime.organizationId, work);
  const due = await runTenant((client) => listDueLeadConnectors(client, runtime.organizationId));
  const results = [];
  for (const connectorId of due) {
    try {
      results.push({ connectorId, ...(await pullLeadConnector({ runTenant }, runtime.organizationId, connectorId)) });
    } catch (error) {
      results.push({ connectorId, error: String(error?.message || error).slice(0, 300) });
    }
  }
  return { connectors: results.length, results };
}
