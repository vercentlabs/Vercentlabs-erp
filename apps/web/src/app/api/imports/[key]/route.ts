import { runImport } from "@vercentlabs/api";

import { HttpError, ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { toWire } from "@/core/wire";

import { readImportUpload } from "../upload";

// Step 2: check (dryRun) or import the file. Multipart: file, mapping (JSON { header: field }), dryRun.
export async function POST(request: Request, context: { params: Promise<{ key: string }> }) {
  return workspaceRoute(request, { snapshot: true, billingWrite: true, action: "imports.run" }, async ({ client, session, snapshot }) => {
    const { key } = await context.params;
    const upload = await readImportUpload(request);
    let mapping: Record<string, string> | null = null;
    try {
      mapping = upload.field("mapping") ? JSON.parse(upload.field("mapping")) : null;
    } catch {
      throw new HttpError(400, "The column mapping is not valid.");
    }
    const result = await runImport(client, session, snapshot?.accessibleModules ?? [], key, { bytes: upload.bytes, fileName: upload.fileName, mapping, dryRun: upload.field("dryRun") === "true" });
    return ok({ result: toWire(result) });
  });
}
