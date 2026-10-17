import { createComment, getCommentsForRecord } from "@vercentlabs/api";
import { z } from "zod";

import { projectsMutation, projectsRead } from "@/features/projects/shared/route-helpers";

// A record's discussion: GET ?parentType=PROJECT|TASK|MILESTONE&parentId=&before=&limit=&summary=1 · POST a comment or a reply.
// Access is the record's own (the domain checks the project, task or milestone, and the comment's visibility).
export async function GET(request: Request) {
  return projectsRead(request, async (client, context, url) => getCommentsForRecord(client, context, {
    parentType: url.searchParams.get("parentType") ?? "", parentId: url.searchParams.get("parentId") ?? "", before: url.searchParams.get("before") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined, summary: url.searchParams.get("summary") === "1",
  }), "projects.comments.view");
}
const schema = z.object({
  parentType: z.string().max(20), parentId: z.string().max(64), body: z.string().max(40000), replyToId: z.string().max(64).nullish(), visibility: z.enum(["INHERIT", "RESTRICTED"]).optional(),
  mentionUserIds: z.array(z.string().max(64)).max(50).optional(), attachmentIds: z.array(z.string().max(64)).max(50).optional(), idempotencyKey: z.string().max(200).optional(),
});
export async function POST(request: Request) {
  return projectsMutation(request, schema, async (client, context, input) => createComment(client, context, input), 201, "projects.comments.view");
}
