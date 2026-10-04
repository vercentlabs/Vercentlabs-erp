import { downloadAttachment } from "@vercentlabs/api/crm";

import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { contentDisposition, type ContentRouteParams } from "@/features/crm/notes/server/content-http";

// Private, authorized file download. ?inline=1 shows a PDF, image or text file
// in the browser; every other file, and every file without inline, downloads.
export async function GET(request: Request, { params }: ContentRouteParams) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session }) => {
    const wantsInline = new URL(request.url).searchParams.get("inline") === "1";
    const file = await downloadAttachment(client, crmContext(session), (await params).id, { inline: wantsInline });
    const inline = wantsInline && file.inline;
    const contentType = !inline ? "application/octet-stream" : file.preview === "text" ? "text/plain; charset=utf-8" : file.mimeType;
    return new Response(new Uint8Array(file.body), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": contentDisposition(inline ? "inline" : "attachment", file.fileName),
        "Content-Length": String(file.body.length),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        // a file never runs script or loads anything (the browser's PDF viewer cannot work sandboxed)
        "Content-Security-Policy": file.preview === "pdf" && inline ? "default-src 'none'; object-src 'self'" : "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
      },
    });
  });
}
