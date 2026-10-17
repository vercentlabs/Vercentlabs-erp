import { readExpenseFile, removeExpenseFile } from "@vercentlabs/api";
import { z } from "zod";

import { workspaceRoute } from "@/core/workspace-route";
import { projectsContext } from "@/features/projects/shared/projects-context";
import { projectsMutation } from "@/features/projects/shared/route-helpers";

// One receipt: download it through its expense, or remove it from a draft.
type Params = { params: Promise<{ expenseId: string; fileId: string }> };
export async function GET(request: Request, ctx: Params) {
  const { expenseId, fileId } = await ctx.params;
  return workspaceRoute(request, { module: "projects", permission: "projects.view" }, async ({ client, session }) => {
    const file = await readExpenseFile(client, projectsContext(session), expenseId, fileId);
    return new Response(new Uint8Array(file.body), {
      headers: {
        "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        "Content-Length": String(file.body.length), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
export async function DELETE(request: Request, ctx: Params) {
  const { expenseId, fileId } = await ctx.params;
  return projectsMutation(request, z.record(z.string(), z.unknown()), async (client, context) => removeExpenseFile(client, context, expenseId, fileId));
}
