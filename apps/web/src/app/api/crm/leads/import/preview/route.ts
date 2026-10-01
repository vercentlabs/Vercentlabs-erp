import { LEAD_IMPORT_LIMITS, previewLeadImport } from "@vercentlabs/api/crm";
import { parseCsvUpload } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { HttpError, ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

// F021 Lead import — stage 1 of 2 (dry run -> commit). The uploaded file is
// parsed HERE (Shared Platform CSV parser); previewLeadImport validates every
// row and stages a snapshot without creating any Lead (not billing-gated;
// the commit step is).
export async function POST(request: Request) {
  return workspaceRoute(
    request,
    {
      module: "crm",
      permissions: [CRM_PERMISSIONS.import, CRM_PERMISSIONS.leadsManage],
      action: "crm.leads.import.preview",
    },
    async ({ client, session }) => {
      // Bounded before the multipart body is read into memory.
      const declared = Number(request.headers.get("content-length") || "0");
      if (!declared || declared > LEAD_IMPORT_LIMITS.maxBytes + 64 * 1024)
        throw new HttpError(
          413,
          `Upload a CSV file of at most ${LEAD_IMPORT_LIMITS.maxBytes / (1024 * 1024)} MB.`,
        );
      const form = await request.formData().catch(() => {
        throw new HttpError(400, "Upload a CSV file.");
      });
      const file = form.get("file");
      if (!(file instanceof File))
        throw new HttpError(400, "Upload a CSV file.");
      let fieldMapping: Record<string, string>;
      try {
        fieldMapping = JSON.parse(String(form.get("fieldMapping") ?? "{}"));
      } catch {
        throw new HttpError(400, "The column mapping is invalid.");
      }
      const parsed = parseCsvUpload(Buffer.from(await file.arrayBuffer()), {
        maxBytes: LEAD_IMPORT_LIMITS.maxBytes,
        maxRows: LEAD_IMPORT_LIMITS.maxRows,
      });
      const result = await previewLeadImport(client, crmContext(session), {
        rows: parsed.records,
        fieldMapping,
        fileName: file.name.slice(0, 240),
        duplicateStrategy: String(form.get("duplicateStrategy") ?? "skip"),
      });
      return ok(result);
    },
  );
}
