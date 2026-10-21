import { z } from "zod";

import { getGstDetailsStatus, saveGstDetails } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// "Is your business registered for GST?" — Yes: the GSTIN (its state comes from it); No: the state only, and documents are made
// without GST. Saved to the company registration that Settings › Company and Settings › Taxes use.
export async function GET(request: Request) {
  return workspaceRoute(request, { action: "settings.gst_details.view" }, async ({ client, session }) => ok({ gst: await getGstDetailsStatus(client, session) }));
}
const schema = z.object({ registered: z.boolean(), gstin: z.string().max(20).optional(), stateCode: z.string().max(2).optional() });
export async function POST(request: Request) {
  return workspaceRoute(request, { action: "settings.gst_details.update", billingWrite: true }, async ({ client, session }) =>
    ok({ gst: await saveGstDetails(client, session, schema.parse(await readJson(request))) }));
}
