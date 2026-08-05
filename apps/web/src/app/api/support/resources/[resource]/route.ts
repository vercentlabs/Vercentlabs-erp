import {
  createKnowledgeArticle,
  createSlaPolicy,
  createSupportQueue,
  createSupportTicket,
  listSupportResource,
} from "@vercentlabs/api";
import { NextRequest, NextResponse } from "next/server";

import { requireApiWorkspace } from "@/lib/auth";
import { tenantTransaction } from "@/lib/db";
import { supportContext } from "@/lib/support";
import {
  supportQueueCreateSchema,
  supportSlaCreateSchema,
  supportTicketCreateSchema,
} from "@/lib/support-validation";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ resource: string }> },
) {
  const session = await requireApiWorkspace();
  const { resource } = await params;
  const rows = await tenantTransaction(session.organizationId, (client) =>
    listSupportResource(client, supportContext(session), resource, {
      customerId: request.nextUrl.searchParams.get("customerId"),
      queueId: request.nextUrl.searchParams.get("queueId"),
      limit: Number(request.nextUrl.searchParams.get("limit") || 100),
      offset: Number(request.nextUrl.searchParams.get("offset") || 0),
    }),
  );
  return NextResponse.json({ ok: true, rows });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ resource: string }> },
) {
  const session = await requireApiWorkspace();
  const { resource } = await params;
  const body = await request.json();

  const row = await tenantTransaction(session.organizationId, (client) => {
    if (resource === "tickets") {
      return createSupportTicket(
        client,
        supportContext(session),
        supportTicketCreateSchema.parse(body),
      );
    }
    if (resource === "queues") {
      return createSupportQueue(
        client,
        supportContext(session),
        supportQueueCreateSchema.parse(body),
      );
    }
    if (resource === "sla-policies") {
      return createSlaPolicy(
        client,
        supportContext(session),
        supportSlaCreateSchema.parse(body),
      );
    }
    if (resource === "knowledge") {
      return createKnowledgeArticle(client, supportContext(session), body);
    }
    throw new Error("Creation is not supported for this resource.");
  });

  return NextResponse.json({ ok: true, row }, { status: 201 });
}
