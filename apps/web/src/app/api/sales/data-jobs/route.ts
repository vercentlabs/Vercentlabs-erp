import { listSalesDataJobs, requestSalesImportJob } from "@vercentlabs/api";

import { HttpError, ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { readUpload } from "@/features/sales/customers/server/customer-http";
import { salesContext } from "@/features/sales/shared/sales-context";
import { toWire } from "@/features/sales/shared/wire";

// Sales imports that run in the background (Line-by-line audit P5). GET: the person's own runs (?entities=customers,prices);
// POST (multipart: entity, file, mapping JSON, options JSON): queue one. The import's own permission is checked by the domain when the
// file is read, and again by the worker when it runs.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "sales" }, async ({ client, session }) => {
    const entities = (new URL(request.url).searchParams.get("entities") ?? "").split(",").filter(Boolean);
    return ok({ jobs: toWire(await listSalesDataJobs(client, salesContext(session), { entities })) });
  });
}

export async function POST(request: Request) {
  return workspaceRoute(request, { module: "sales", billingWrite: true }, async ({ client, session }) => {
    const upload = await readUpload(request);
    const parse = (name: string) => {
      try {
        return JSON.parse(upload.field(name) || "{}");
      } catch {
        throw new HttpError(400, `The ${name} is not valid.`);
      }
    };
    const job = await requestSalesImportJob(client, salesContext(session), {
      entity: upload.field("entity"), bytes: upload.bytes, fileName: upload.fileName, mapping: parse("mapping"), options: parse("options"),
    });
    return ok({ job: toWire(job) }, 202);
  });
}
