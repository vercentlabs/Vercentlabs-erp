import { z } from "zod";

import { saveCompanySmtp } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

const schema = z.object({ host: z.string().min(1).max(253), port: z.number().int().min(1).max(65535), secure: z.boolean().optional(), username: z.string().min(1).max(320), password: z.string().max(500).optional() });

// The company's own SMTP server; a test message is sent to you before it is used.
export async function POST(request: Request) {
  return workspaceRoute(request, { permission: CORE_PERMISSIONS.organizationManage, action: "mail.smtp.save", auditDenial: true }, async ({ client, session }) =>
    ok(await saveCompanySmtp(client, session, schema.parse(await readJson(request)))));
}
