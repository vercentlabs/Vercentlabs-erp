import { z } from "zod";

import { setupMailDomain, verifyMailDomain } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

const schema = z.object({ domain: z.string().min(3).max(253) });

// Set up sending from the company's own domain: a DKIM key to publish in DNS.
export async function POST(request: Request) {
  return workspaceRoute(request, { permission: CORE_PERMISSIONS.organizationManage, action: "mail.domain.setup" }, async ({ client, session }) =>
    ok({ settings: await setupMailDomain(client, session, schema.parse(await readJson(request))) }));
}

// Check the DNS records.
export async function PUT(request: Request) {
  return workspaceRoute(request, { permission: CORE_PERMISSIONS.organizationManage, action: "mail.domain.verify" }, async ({ client, session }) =>
    ok(await verifyMailDomain(client, session)));
}
