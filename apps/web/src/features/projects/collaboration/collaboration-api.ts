"use client";

// Projects — Comments and Collaboration: the client of a record's discussion, My Work's mentions and unread discussions, search, reports and
// the comment policy. Every post carries its key, so a lost answer is never posted twice.
import { call, qs, send } from "../api/projects-api";

export type ParentType = "PROJECT" | "TASK" | "MILESTONE";
export type Person = { id: string; name: string; active: boolean };
export type CommentFile = { id: string; fileName: string; mimeType: string | null; sizeBytes: number; source: "UPLOADED" | "REFERENCED" };
export type Comment = {
  id: string; sequence: number; replyToId: string | null; visibility: "INHERIT" | "RESTRICTED"; deleted: boolean; version: number; body: string | null; author: Person | null; mine: boolean;
  createdAt: string; editedAt: string | null; deletedAt: string | null; deletedBy: string | null; moderated: boolean; mentions: Person[]; attachments: CommentFile[];
  can: { edit: boolean; delete: boolean; moderate: boolean; reply: boolean; attach: boolean; history: boolean };
  replies?: Comment[];
};
export type Discussion = {
  parentType: ParentType; parentId: string; projectId: string; label: string; kind: string; readOnly: boolean; readOnlyReason: string | null;
  can: { comment: boolean; reply: boolean; restricted: boolean; attach: boolean; mention: boolean; moderate: boolean };
  policy: { editWindowMinutes: number; maxLength: number };
};
export type ReaderState = { total: number; unread: number; newestSequence: number; lastReadSequence: number; following: boolean; muted: boolean };
export type Thread = ReaderState & { discussion: Discussion; comments: Comment[]; hasMore: boolean; nextBefore: number | null };
export type DiscussionItem = {
  id: string; sequence: number; parentType: ParentType; parentId: string; kind: string; parentLabel: string; projectId: string; projectLabel: string; href: string;
  visibility: string; isReply: boolean; excerpt: string; author: Person | null; createdAt: string; editedAt: string | null; attachmentCount: number; unread?: boolean;
};
export type FollowedItem = { parentType: ParentType; parentId: string; kind: string; label: string; projectId: string; projectLabel: string; href: string; total: number; unread: number;
  lastAt: string; lastExcerpt: string; lastAuthor: string | null };
export type Page<T> = { total: number; unread?: number; page: number; pageSize: number; items: T[] };
export type History = {
  commentId: string; status: string; author: Person | null; createdAt: string; deleted: { at: string; by: Person | null; reason: string | null } | null;
  versions: Array<{ version: number; body: string; editedBy: Person | null; editedAt: string; reason: string | null; mentions: Person[]; attachmentCount: number }>;
};
export type CommentSettings = { editWindowMinutes: number; maxLength: number; can: { manage: boolean } };

export const getThread = (parentType: ParentType, parentId: string, before?: number | null) => call<Thread>(`/comments${qs({ parentType, parentId, before: before ?? undefined })}`);
export const getThreadSummary = (parentType: ParentType, parentId: string) => call<ReaderState & { discussion: Discussion }>(`/comments${qs({ parentType, parentId, summary: 1 })}`);
export const postComment = (input: { parentType: ParentType; parentId: string; body: string; replyToId?: string | null; visibility?: "INHERIT" | "RESTRICTED"; mentionUserIds?: string[];
  attachmentIds?: string[]; idempotencyKey: string }) => send<{ commentId: string; sequence: number; replayed?: boolean }>("/comments", input);
export const editComment = (id: string, input: { body: string; mentionUserIds?: string[]; expectedVersion: number }) => send<{ commentId: string; version: number }>(`/comments/${id}`, input, "PATCH");
export const deleteComment = (id: string, input: { reason?: string; expectedVersion?: number }) => send(`/comments/${id}`, input, "DELETE");
export const getHistory = (id: string) => call<{ history: History }>(`/comments/${id}/history`).then((r) => r.history);
export async function uploadCommentFile(id: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  return call<{ file: { id: string; fileName: string } }>(`/comments/${id}/files`, { method: "POST", body: form }).then((r) => r.file);
}
export const removeCommentFile = (id: string, fileId: string) => send(`/comments/${id}/files/${fileId}`, {}, "DELETE");
export const commentFileHref = (id: string, fileId: string) => `/api/projects/comments/${id}/files/${fileId}`;
export const getMentionable = (parentType: ParentType, parentId: string, search: string, visibility: string) =>
  call<{ people: Array<{ id: string; name: string; email: string }> }>(`/discussions/mentionable${qs({ parentType, parentId, search, visibility })}`).then((r) => r.people);
export const getReferenceableFiles = (parentType: ParentType, parentId: string) =>
  call<{ files: Array<{ id: string; fileName: string; sizeBytes: number }> }>(`/discussions/referenceable-files${qs({ parentType, parentId })}`).then((r) => r.files);
export const setSubscription = (parentType: ParentType, parentId: string, status: "FOLLOWING" | "MUTED") => send("/discussions/subscription", { parentType, parentId, status });
export const markRead = (parentType: ParentType, parentId: string, upToSequence?: number) => send("/discussions/read", { parentType, parentId, upToSequence });
export const getMentions = (filters: Record<string, string | number | undefined>) => call<Page<DiscussionItem>>(`/discussions/mentions${qs(filters)}`);
export const getUnread = (filters: Record<string, string | number | undefined>) => call<Page<FollowedItem>>(`/discussions/unread${qs(filters)}`);
export const getFollowed = (filters: Record<string, string | number | undefined>) => call<Page<FollowedItem>>(`/discussions/followed${qs(filters)}`);
export const searchComments = (filters: Record<string, string | number | undefined>) => call<Page<DiscussionItem>>(`/discussions/search${qs(filters)}`);
export const getInbox = () => call<{ mentions: number; unreadDiscussions: number; unreadComments: number }>("/discussions/inbox");
export const getCounts = (parentType: ParentType, parentIds: string[]) =>
  call<{ counts: Record<string, { total: number; unread: number }> }>(`/discussions/counts${qs({ parentType, parentIds: parentIds.join(",") })}`).then((r) => r.counts);
export type TimelineItem = { id: string; source: "ACTIVITY" | "COMMENT"; sourceLabel: string; action: string; summary: string | null; actor: string; at: string; href: string | null; restricted?: boolean };
export const getTimeline = (projectId: string) => call<{ items: TimelineItem[] }>(`/discussions/timeline${qs({ projectId })}`).then((r) => r.items);
export const getCollaborationReport = <T = Record<string, unknown>>(kind: string, filters: Record<string, string | undefined> = {}) =>
  call<{ rows: T[] }>(`/discussions/report${qs({ kind, ...filters })}`).then((r) => r.rows);
export const discussionsExportHref = (filters: Record<string, string | undefined>) => `/api/projects/discussions/export${qs(filters)}`;
export const getCommentSettings = () => call<{ settings: CommentSettings }>("/discussions/settings").then((r) => r.settings);
export const saveCommentSettings = (input: Partial<CommentSettings>) => send<{ settings: CommentSettings }>("/discussions/settings", input);
export const DISCUSSIONS_BASE = "/projects/discussions";
