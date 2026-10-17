import {
  getCollaborationInbox, getCollaborationReport, getCommentSettings, getDiscussionCounts, getFollowedDiscussions, getMyMentions, getProjectCollaborationTimeline, getRecentDiscussions,
  getReferenceableFiles, getUnreadDiscussions, markDiscussionRead, resolveEligibleMentions, saveCommentSettings, searchAuthorizedComments, subscribeToDiscussion,
} from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { projectsMutation, projectsRead } from "@/features/projects/shared/route-helpers";

// My Work and the discussion tools. Every result is filtered by the reader's current access to each record and comment.
// GET mentions · unread · followed · recent · search · inbox · counts · mentionable · referenceable-files · timeline · report · settings
type Params = { params: Promise<{ view: string }> };
const KEYS = ["q", "projectId", "parentType", "parentId", "authorId", "mentionedId", "from", "to", "hasAttachments", "unread", "page", "pageSize", "search", "visibility", "kind", "parentIds", "limit"];
export async function GET(request: Request, ctx: Params) {
  const { view } = await ctx.params;
  return projectsRead(request, async (client, context, url) => {
    const f: Record<string, string> = Object.fromEntries(KEYS.map((key) => [key, url.searchParams.get(key) ?? ""]).filter(([, value]) => value !== ""));
    switch (view) {
      case "mentions": return getMyMentions(client, context, f);
      case "unread": return getUnreadDiscussions(client, context, f);
      case "followed": return getFollowedDiscussions(client, context, f);
      case "recent": return getRecentDiscussions(client, context, f);
      case "search": return searchAuthorizedComments(client, context, f);
      case "inbox": return getCollaborationInbox(client, context);
      case "counts": return getDiscussionCounts(client, context, { parentType: f.parentType, parentIds: f.parentIds });
      case "mentionable": return resolveEligibleMentions(client, context, f);
      case "referenceable-files": return getReferenceableFiles(client, context, f);
      case "timeline": return getProjectCollaborationTimeline(client, context, f.projectId ?? "", f);
      case "report": return getCollaborationReport(client, context, f.kind ?? "recent", f);
      case "settings": return { settings: await getCommentSettings(client, context) };
      default: throw new HttpError(404, "Unknown discussion view.", "NOT_FOUND");
    }
  }, "projects.comments.view");
}
// POST subscription { parentType, parentId, status: FOLLOWING | MUTED } · read { parentType, parentId, upToSequence? } · settings { editWindowMinutes?, maxLength? }
export async function POST(request: Request, ctx: Params) {
  const { view } = await ctx.params;
  return projectsMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => {
    switch (view) {
      case "subscription": return subscribeToDiscussion(client, context, input);
      case "read": return markDiscussionRead(client, context, input);
      case "settings": return { settings: await saveCommentSettings(client, context, input) };
      default: throw new HttpError(404, "Unknown discussion action.", "NOT_FOUND");
    }
  }, 200, "projects.comments.view");
}
