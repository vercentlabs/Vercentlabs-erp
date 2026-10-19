import { z } from "zod";

import {
  addRecordComment, closeRecordActivity, deleteRecordComment, editRecordComment, getRecordThread, RECORD_THREAD_TYPES, scheduleRecordActivity, setRecordFollowing,
} from "@vercentlabs/api";

import { fail, ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// The shared record thread (Shared Platform plan 4) of one record: /api/record-threads/{type}/{id}, e.g. sales.order.
type Params = { params: Promise<{ type: string; id: string }> };
const context = (session: { organizationId: string; userId: string; roleSlugs: string[]; permissions: string[] }) =>
  ({ organizationId: session.organizationId, userId: session.userId, roleSlugs: session.roleSlugs, permissions: session.permissions });

export async function GET(request: Request, { params }: Params) {
  const { type, id } = await params;
  const definition = RECORD_THREAD_TYPES[type];
  if (!definition) return fail("Not found.", 404);
  return workspaceRoute(request, { module: definition.module ?? undefined, action: "record_thread.view" }, async ({ client, session }) =>
    ok({ thread: await getRecordThread(client, context(session), type, id) }));
}

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("comment"), body: z.string().min(1).max(10_000), kind: z.enum(["comment", "note"]).default("comment"), mentions: z.array(z.string().uuid()).max(20).default([]) }),
  z.object({ action: z.literal("edit"), commentId: z.string().uuid(), body: z.string().min(1).max(10_000) }),
  z.object({ action: z.literal("delete"), commentId: z.string().uuid() }),
  z.object({ action: z.literal("follow"), following: z.boolean() }),
  z.object({ action: z.literal("activity"), type: z.enum(["to_do", "call", "meeting", "email"]), summary: z.string().min(1).max(200), note: z.string().max(2000).optional(),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), assignedTo: z.string().uuid().optional() }),
  z.object({ action: z.literal("close"), activityId: z.string().uuid(), outcome: z.enum(["done", "cancelled"]).default("done"), note: z.string().max(2000).optional() }),
]);

export async function POST(request: Request, { params }: Params) {
  const { type, id } = await params;
  const definition = RECORD_THREAD_TYPES[type];
  if (!definition) return fail("Not found.", 404);
  return workspaceRoute(request, { module: definition.module ?? undefined, action: "record_thread.update" }, async ({ client, session }) => {
    const body = schema.parse(await readJson(request));
    const ctx = context(session);
    switch (body.action) {
      case "comment": return ok({ thread: await addRecordComment(client, ctx, type, id, body) }, 201);
      case "edit": return ok({ thread: await editRecordComment(client, ctx, type, id, body.commentId, body) });
      case "delete": return ok({ thread: await deleteRecordComment(client, ctx, type, id, body.commentId) });
      case "follow": return ok({ thread: await setRecordFollowing(client, ctx, type, id, body.following) });
      case "activity": return ok({ thread: await scheduleRecordActivity(client, ctx, type, id, body) }, 201);
      case "close": return ok({ thread: await closeRecordActivity(client, ctx, type, id, body.activityId, body) });
    }
  });
}
