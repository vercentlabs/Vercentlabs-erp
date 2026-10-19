import { analyzeImport } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

import { readImportUpload } from "../../upload";

// Step 1: read the file and propose which column is which. Multipart: file.
export async function POST(request: Request, context: { params: Promise<{ key: string }> }) {
  return workspaceRoute(request, { snapshot: true, action: "imports.analyze" }, async ({ session, snapshot }) => {
    const { key } = await context.params;
    const upload = await readImportUpload(request);
    return ok({ analysis: analyzeImport(session, snapshot?.accessibleModules ?? [], key, { bytes: upload.bytes, fileName: upload.fileName }) });
  });
}
