import { z } from "zod";
import { buildWorkspaceExport, WORKSPACE_EXPORT_JOB_TYPE } from "@vercentlabs/api";

export const JOB_TYPE = WORKSPACE_EXPORT_JOB_TYPE;

export const payloadSchema = z.object({ requestedBy: z.string().uuid().nullable().optional() }).strict();

// The full workspace export (Settings > Company > Your data): every table as CSV and every file in one zip, stored for 7 days; the
// person who asked is told when it is ready. Re-running makes a new export (each is a separate file), so a retry is harmless.
export async function buildWorkspaceExportHandler(client, systemContext, payload) {
  return buildWorkspaceExport(client, { organizationId: systemContext.organizationId, requestedBy: payload?.requestedBy ?? null });
}
