"use client";

// Projects — Comments and Collaboration: the discussion on a project, task or milestone. Comments read oldest to newest with one level of
// replies; new ones since the last visit are marked and the discussion is marked read. The composer mentions people who can already see the
// record (@name), attaches files (uploaded, or already on the record), and posts a restricted comment where allowed. Text is shown as text —
// a small, safe formatting subset (**bold**, _italic_, links) is rendered without ever interpreting HTML. A comment never changes the record:
// approvals, completion and customer acceptance stay on their own actions.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, Dialog, StatusBadge, TextArea } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorCode, errorMessage, newKey } from "../api/projects-api";
import {
  commentFileHref, deleteComment, editComment, getHistory, getMentionable, getReferenceableFiles, getThread, getThreadSummary, markRead, postComment, removeCommentFile, setSubscription,
  uploadCommentFile, type Comment, type Discussion, type ParentType, type Thread,
} from "./collaboration-api";

// ------------------------------------------------------------------ small helpers
export function relativeTime(value: string) {
  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: new Date(value).getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}
const initials = (name: string | undefined | null) => (name ?? "?").split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join("") || "?";
function Avatar({ name, muted = false }: { name: string | null | undefined; muted?: boolean }) {
  return <span aria-hidden className={`flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${muted ? "bg-surface-muted text-text-muted" : "bg-brand-soft text-brand"}`}>{initials(name)}</span>;
}
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Text to React nodes: mentions highlighted, http(s) links, **bold** and _italic_. Nothing in the text is ever treated as markup.
export function renderBody(body: string, mentionNames: string[]): ReactNode[] {
  const names = [...new Set(mentionNames.filter(Boolean))].sort((a, b) => b.length - a.length).map(escapeRegExp);
  const pattern = new RegExp(`${names.length ? `(@(?:${names.join("|")}))|` : "()"}(https?:\\/\\/[^\\s<>"']+)|\\*\\*([^*\\n]+)\\*\\*|(?<![\\w])_([^_\\n]+)_(?![\\w])`, "g");
  const out: ReactNode[] = [];
  let last = 0;
  let index = 0;
  for (const match of body.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > last) out.push(body.slice(last, at));
    const [whole, mention, url, bold, italic] = match;
    if (mention) out.push(<span key={index++} className="rounded bg-brand-soft px-0.5 font-medium text-brand">{mention}</span>);
    else if (url) {
      const clean = url.replace(/[.,;:!?)\]]+$/, "");
      out.push(<a key={index++} href={clean} target="_blank" rel="noopener noreferrer nofollow" className="text-brand underline break-all">{clean}</a>);
      if (clean.length < url.length) out.push(url.slice(clean.length));
    } else if (bold) out.push(<strong key={index++}>{bold}</strong>);
    else if (italic) out.push(<em key={index++}>{italic}</em>);
    else out.push(whole);
    last = at + whole.length;
  }
  if (last < body.length) out.push(body.slice(last));
  return out;
}
const sizeLabel = (bytes: number) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

// ------------------------------------------------------------------ the tab label with its counts
export function useDiscussionSummary(parentType: ParentType, parentId: string | undefined) {
  const workspace = useWorkspaceContext();
  return useQuery({ queryKey: scopedQueryKey(workspace, "projects", "discussion-summary", parentType, parentId ?? ""), queryFn: () => getThreadSummary(parentType, parentId!),
    enabled: Boolean(parentId), staleTime: 30_000, retry: false });
}
export function CommentsTabLabel({ parentType, parentId, label = "Comments" }: { parentType: ParentType; parentId: string; label?: string }) {
  const summary = useDiscussionSummary(parentType, parentId);
  const total = summary.data?.total ?? 0;
  const unread = summary.data?.unread ?? 0;
  return (
    <span className="inline-flex items-center gap-1.5">
      {label}
      {total > 0 && <span className="text-xs text-text-muted">{total}</span>}
      {unread > 0 && <span className="rounded-full bg-brand px-1.5 text-[11px] font-semibold leading-4 text-text-inverse" aria-label={`${unread} unread`}>{unread}</span>}
    </span>
  );
}

// ------------------------------------------------------------------ the composer
type Draft = { body: string; mentions: Array<{ id: string; name: string }>; restricted: boolean; files: File[]; referenced: Array<{ id: string; fileName: string }> };
const EMPTY: Draft = { body: "", mentions: [], restricted: false, files: [], referenced: [] };
function Composer({ discussion, replyTo, restrictedParent = false, autoFocus = false, onDone, onCancel }: {
  discussion: Discussion; replyTo?: Comment; restrictedParent?: boolean; autoFocus?: boolean; onDone: (text: string) => Promise<void>; onCancel?: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [key, setKey] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [pick, setPick] = useState(0);
  const [picker, setPicker] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const restricted = restrictedParent || draft.restricted;
  const people = useQuery({ queryKey: ["projects-mentionable", discussion.parentType, discussion.parentId, query ?? "", restricted], enabled: query !== null && discussion.can.mention,
    queryFn: () => getMentionable(discussion.parentType, discussion.parentId, query ?? "", restricted ? "RESTRICTED" : "INHERIT"), staleTime: 30_000 });
  const options = query === null ? [] : (people.data ?? []);
  useEffect(() => { if (autoFocus) area.current?.focus(); }, [autoFocus]);
  const remaining = discussion.policy.maxLength - draft.body.length;

  const typed = (value: string) => {
    setDraft((current) => ({ ...current, body: value }));
    const caret = area.current?.selectionStart ?? value.length;
    const match = discussion.can.mention ? /(?:^|\s)@([\p{L}\p{N}._-]{0,30})$/u.exec(value.slice(0, caret)) : null;
    setQuery(match ? match[1]! : null);
    setPick(0);
  };
  const choose = (person: { id: string; name: string }) => {
    const el = area.current;
    const caret = el?.selectionStart ?? draft.body.length;
    const before = draft.body.slice(0, caret).replace(/@([\p{L}\p{N}._-]{0,30})$/u, `@${person.name} `);
    const body = before + draft.body.slice(caret);
    setDraft((current) => ({ ...current, body, mentions: current.mentions.some((row) => row.id === person.id) ? current.mentions : [...current.mentions, { id: person.id, name: person.name }] }));
    setQuery(null);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(before.length, before.length); });
  };
  const keys = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (options.length) {
      if (event.key === "ArrowDown") { event.preventDefault(); setPick((pick + 1) % options.length); return; }
      if (event.key === "ArrowUp") { event.preventDefault(); setPick((pick - 1 + options.length) % options.length); return; }
      if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); choose(options[pick]!); return; }
      if (event.key === "Escape") { event.preventDefault(); setQuery(null); return; }
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void submit(); }
  };
  const submit = async () => {
    if (busy) return;
    if (!draft.body.trim()) { setError("Write a comment before posting."); return; }
    setBusy(true); setError(null);
    // Only the people still named in the text are mentioned.
    const mentionUserIds = draft.mentions.filter((row) => draft.body.includes(`@${row.name}`)).map((row) => row.id);
    try {
      const result = await postComment({ parentType: discussion.parentType, parentId: discussion.parentId, body: draft.body, replyToId: replyTo?.id ?? null,
        visibility: restricted ? "RESTRICTED" : "INHERIT", mentionUserIds, attachmentIds: draft.referenced.map((row) => row.id), idempotencyKey: key });
      const failed: string[] = [];
      for (const file of draft.files) { try { await uploadCommentFile(result.commentId, file); } catch (failure) { failed.push(`${file.name}: ${errorMessage(failure)}`); } }
      setDraft(EMPTY); setKey(newKey());
      await onDone(failed.length ? `Posted, but some files were not attached — ${failed.join("; ")}` : replyTo ? "Reply posted." : "Comment posted.");
    } catch (failure) {
      // A lost answer keeps the same key: posting again is checked, never duplicated.
      setError(errorCode(failure) === "COMMENT_OPERATION_UNKNOWN" ? "Checking whether your comment was saved. Please do not post it again yet." : errorMessage(failure));
    } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col gap-2">
      {error && <Notice tone="danger">{error}</Notice>}
      <div className={`relative rounded-lg border bg-surface focus-within:ring-2 focus-within:ring-focus ${restricted ? "border-warning-emphasis/50" : "border-border"}`}>
        <textarea ref={area} value={draft.body} onChange={(event) => typed(event.target.value)} onKeyDown={keys} onBlur={() => setTimeout(() => setQuery(null), 150)}
          rows={replyTo ? 2 : 3} maxLength={discussion.policy.maxLength} aria-label={replyTo ? "Write a reply" : "Write a comment"}
          placeholder={replyTo ? `Reply to ${replyTo.author?.name ?? "this comment"}…` : discussion.can.mention ? "Write a comment… type @ to mention someone" : "Write a comment…"}
          className="block min-h-16 w-full resize-y rounded-lg bg-transparent px-3 py-2 text-sm outline-none placeholder:text-text-muted" />
        {options.length > 0 && (
          <ul role="listbox" aria-label="People to mention" className="absolute left-2 top-full z-20 mt-1 max-h-60 w-72 max-w-[calc(100%-1rem)] overflow-auto rounded-lg border border-border bg-surface p-1 shadow-lg">
            {options.map((person, index) => (
              <li key={person.id} role="option" aria-selected={index === pick}>
                <button type="button" onMouseDown={(event) => { event.preventDefault(); choose(person); }}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${index === pick ? "bg-surface-muted" : "hover:bg-surface-muted"}`}>
                  <Avatar name={person.name} /><span className="min-w-0"><span className="block truncate font-medium">{person.name}</span><span className="block truncate text-xs text-text-muted">{person.email}</span></span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {query !== null && !people.isLoading && options.length === 0 && (
          <p className="absolute left-2 top-full z-20 mt-1 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text-muted shadow-lg">No one with access to this record matches.</p>
        )}
        {(draft.files.length > 0 || draft.referenced.length > 0) && (
          <div className="flex flex-wrap gap-1.5 border-t border-border px-3 py-2">
            {draft.files.map((file, index) => (
              <span key={`f${index}`} className="inline-flex items-center gap-1 rounded-full bg-surface-muted px-2 py-0.5 text-xs">{`${file.name} · ${sizeLabel(file.size)}`}
                <button type="button" aria-label={`Remove ${file.name}`} className="text-text-muted hover:text-danger" onClick={() => setDraft((current) => ({ ...current, files: current.files.filter((_, i) => i !== index) }))}>×</button></span>
            ))}
            {draft.referenced.map((file) => (
              <span key={file.id} className="inline-flex items-center gap-1 rounded-full bg-surface-muted px-2 py-0.5 text-xs">{`${file.fileName} · from the record`}
                <button type="button" aria-label={`Remove ${file.fileName}`} className="text-text-muted hover:text-danger" onClick={() => setDraft((current) => ({ ...current, referenced: current.referenced.filter((row) => row.id !== file.id) }))}>×</button></span>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-2 py-1.5">
          {discussion.can.attach && (
            <>
              <input ref={fileInput} type="file" multiple className="hidden" onChange={(event) => { const list = Array.from(event.target.files ?? []); setDraft((current) => ({ ...current, files: [...current.files, ...list].slice(0, 10) })); event.target.value = ""; }} />
              <Button size="compact" variant="ghost" onPress={() => fileInput.current?.click()}>Attach file</Button>
              <Button size="compact" variant="ghost" onPress={() => setPicker(true)}>From this record</Button>
            </>
          )}
          {!replyTo && discussion.can.restricted && (
            <Checkbox isSelected={draft.restricted} onChange={(on) => setDraft((current) => ({ ...current, restricted: on }))}>Restricted</Checkbox>
          )}
          {restrictedParent && <StatusBadge tone="warning">Restricted reply</StatusBadge>}
          <span className="ml-auto flex items-center gap-2">
            {remaining < 200 && <span className={`text-xs ${remaining < 0 ? "text-danger" : "text-text-muted"}`}>{remaining}</span>}
            {onCancel && <Button size="compact" variant="ghost" onPress={onCancel}>Cancel</Button>}
            <Button size="compact" variant="primary" isLoading={busy} isDisabled={busy || !draft.body.trim()} onPress={submit}>{replyTo ? "Reply" : "Post"}</Button>
          </span>
        </div>
      </div>
      {restricted && !restrictedParent && <p className="text-xs text-warning">Only the project&apos;s managers and people allowed to read restricted discussions will see this comment.</p>}
      {picker && <RecordFilesDialog discussion={discussion} chosen={draft.referenced} onClose={() => setPicker(false)}
        onChoose={(files) => { setDraft((current) => ({ ...current, referenced: files })); setPicker(false); }} />}
    </div>
  );
}
function RecordFilesDialog({ discussion, chosen, onClose, onChoose }: { discussion: Discussion; chosen: Array<{ id: string; fileName: string }>; onClose: () => void; onChoose: (files: Array<{ id: string; fileName: string }>) => void }) {
  const files = useQuery({ queryKey: ["projects-referenceable", discussion.parentType, discussion.parentId], queryFn: () => getReferenceableFiles(discussion.parentType, discussion.parentId) });
  const [picked, setPicked] = useState(chosen);
  return (
    <Dialog isOpen isDismissable onOpenChange={(next) => { if (!next) onClose(); }} title={`Files on this ${discussion.kind.toLowerCase()}`} description="Link a file already on the record; its access stays the record's.">
      <div className="flex flex-col gap-2">
        {files.isLoading && <LoadingState label="Loading files" rows={3} />}
        {files.data?.length === 0 && <p className="text-sm text-text-muted">This record has no files yet.</p>}
        {(files.data ?? []).map((file) => (
          <Checkbox key={file.id} isSelected={picked.some((row) => row.id === file.id)}
            onChange={(on) => setPicked((current) => (on ? [...current, { id: file.id, fileName: file.fileName }] : current.filter((row) => row.id !== file.id)))}>{`${file.fileName} · ${sizeLabel(file.sizeBytes)}`}</Checkbox>
        ))}
        <div className="mt-2 flex justify-end gap-2"><Button variant="secondary" onPress={onClose}>Cancel</Button><Button variant="primary" onPress={() => onChoose(picked)}>Attach</Button></div>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ one comment
function CommentItem({ comment, discussion, isNew, highlighted, onChanged, children }: {
  comment: Comment; discussion: Discussion; isNew: boolean; highlighted: boolean; onChanged: (text: string) => Promise<void>; children?: ReactNode;
}) {
  const [mode, setMode] = useState<"view" | "edit" | "reply">("view");
  const [body, setBody] = useState(comment.body ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"delete" | "history" | null>(null);
  const names = comment.mentions.map((row) => row?.name ?? "").filter(Boolean);
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const keep = comment.mentions.filter((row) => row && body.includes(`@${row.name}`)).map((row) => row.id);
      await editComment(comment.id, { body, mentionUserIds: keep, expectedVersion: comment.version });
      setMode("view"); await onChanged("Comment updated.");
    } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  };
  const remove = async (file: string) => {
    try { await removeCommentFile(comment.id, file); await onChanged("File removed from the comment."); } catch (failure) { setError(errorMessage(failure)); }
  };
  if (comment.deleted) {
    return (
      <li id={`comment-${comment.id}`} className="flex gap-3">
        <Avatar name={null} muted />
        <div className="min-w-0 flex-1">
          <p className="rounded-lg border border-dashed border-border px-3 py-2 text-sm italic text-text-muted">{comment.moderated ? "Comment removed by a moderator." : "Comment removed."}</p>
          {children}
        </div>
      </li>
    );
  }
  return (
    <li id={`comment-${comment.id}`} className={`group flex gap-3 rounded-lg transition-colors ${highlighted ? "bg-brand-soft/60 ring-1 ring-brand-border" : ""}`}>
      <Avatar name={comment.author?.name} muted={comment.author ? !comment.author.active : true} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-sm font-semibold">{comment.author?.name ?? "Former user"}</span>
          {comment.author && !comment.author.active && <span className="text-xs text-text-muted">former member</span>}
          <time className="text-xs text-text-muted" dateTime={comment.createdAt} title={formatDateTime(comment.createdAt)}>{relativeTime(comment.createdAt)}</time>
          {comment.editedAt && (comment.can.history
            ? <button type="button" className="text-xs text-text-muted underline decoration-dotted hover:text-text" onClick={() => setDialog("history")}>edited</button>
            : <span className="text-xs text-text-muted" title={formatDateTime(comment.editedAt)}>edited</span>)}
          {comment.visibility === "RESTRICTED" && <StatusBadge tone="warning">Restricted</StatusBadge>}
          {isNew && <StatusBadge tone="info">New</StatusBadge>}
        </div>
        {mode === "edit" ? (
          <div className="mt-1 flex flex-col gap-2">
            {error && <Notice tone="danger">{error}</Notice>}
            <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={3} maxLength={discussion.policy.maxLength} aria-label="Edit the comment"
              className="block w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-focus" />
            <div className="flex justify-end gap-2">
              <Button size="compact" variant="ghost" onPress={() => { setMode("view"); setBody(comment.body ?? ""); setError(null); }}>Cancel</Button>
              <Button size="compact" variant="primary" isLoading={busy} isDisabled={busy || !body.trim() || body === comment.body} onPress={save}>Save</Button>
            </div>
          </div>
        ) : (
          <div className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-relaxed">{renderBody(comment.body ?? "", names)}</div>
        )}
        {comment.attachments.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {comment.attachments.map((file) => (
              <li key={file.id} className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-muted px-2 py-1 text-xs">
                <a className="text-brand hover:underline" href={commentFileHref(comment.id, file.id)}>{file.fileName}</a>
                <span className="text-text-muted">{sizeLabel(file.sizeBytes)}{file.source === "REFERENCED" ? " · from the record" : ""}</span>
                {(comment.can.attach || comment.can.moderate) && <button type="button" aria-label={`Remove ${file.fileName}`} className="text-text-muted hover:text-danger" onClick={() => remove(file.id)}>×</button>}
              </li>
            ))}
          </ul>
        )}
        {error && mode !== "edit" && <Notice tone="danger" className="mt-2">{error}</Notice>}
        {mode !== "edit" && (comment.can.reply || comment.can.edit || comment.can.delete) && (
          <div className="mt-1 flex flex-wrap gap-3 text-xs font-medium text-text-muted">
            {comment.can.reply && discussion.can.reply && <button type="button" className="hover:text-brand" onClick={() => setMode(mode === "reply" ? "view" : "reply")}>Reply</button>}
            {comment.can.edit && <button type="button" className="hover:text-brand" onClick={() => setMode("edit")}>Edit</button>}
            {comment.can.delete && <button type="button" className="hover:text-danger" onClick={() => setDialog("delete")}>Remove</button>}
          </div>
        )}
        {children}
        {mode === "reply" && (
          <div className="mt-2">
            <Composer discussion={discussion} replyTo={comment} restrictedParent={comment.visibility === "RESTRICTED"} autoFocus onCancel={() => setMode("view")}
              onDone={async (text) => { setMode("view"); await onChanged(text); }} />
          </div>
        )}
      </div>
      {dialog === "delete" && <RemoveDialog comment={comment} onClose={() => setDialog(null)} onDone={async (text) => { setDialog(null); await onChanged(text); }} />}
      {dialog === "history" && <HistoryDialog comment={comment} onClose={() => setDialog(null)} />}
    </li>
  );
}
function RemoveDialog({ comment, onClose, onDone }: { comment: Comment; onClose: () => void; onDone: (text: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const moderating = !comment.mine;
  const run = async () => {
    setBusy(true); setError(null);
    try { await deleteComment(comment.id, { reason: reason.trim() || undefined, expectedVersion: comment.version }); await onDone("Comment removed."); }
    catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  };
  return (
    <Dialog isOpen isDismissable onOpenChange={(next) => { if (!next) onClose(); }} title={moderating ? "Remove this comment as a moderator?" : "Remove your comment?"}
      description={moderating ? "The discussion will show that a moderator removed it. Its text and history stay in the audit." : "The discussion will show “Comment removed”; replies stay."}>
      <div className="flex flex-col gap-3">
        {error && <Notice tone="danger">{error}</Notice>}
        {moderating && <TextArea label="Reason" value={reason} onChange={setReason} maxLength={500} isRequired />}
        <div className="flex justify-end gap-2"><Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="danger" isLoading={busy} isDisabled={busy || (moderating && !reason.trim())} onPress={run}>Remove</Button></div>
      </div>
    </Dialog>
  );
}
function HistoryDialog({ comment, onClose }: { comment: Comment; onClose: () => void }) {
  const history = useQuery({ queryKey: ["projects-comment-history", comment.id, comment.version], queryFn: () => getHistory(comment.id) });
  return (
    <Dialog isOpen isDismissable onOpenChange={(next) => { if (!next) onClose(); }} title="Edit history" size="lg">
      {history.isLoading && <LoadingState label="Loading the history" rows={3} />}
      {history.isError && <Notice tone="danger">{errorMessage(history.error)}</Notice>}
      <ol className="flex flex-col gap-3">
        {[...(history.data?.versions ?? [])].reverse().map((version) => (
          <li key={version.version} className="rounded-lg border border-border p-3">
            <p className="text-xs text-text-muted">{`Version ${version.version} · ${version.editedBy?.name ?? "—"} · ${formatDateTime(version.editedAt)}${version.reason ? ` · ${version.reason}` : ""}`}</p>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">{version.body}</p>
          </li>
        ))}
      </ol>
    </Dialog>
  );
}

// ------------------------------------------------------------------ the discussion
export function CommentThread({ parentType, parentId, title = "Comments", description }: { parentType: ParentType; parentId: string; title?: string; description?: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const params = useSearchParams();
  const focus = params.get("comment");
  const key = scopedQueryKey(workspace, "projects", "discussion", parentType, parentId);
  const [older, setOlder] = useState<Thread["comments"]>([]);
  const [nextBefore, setNextBefore] = useState<number | null | undefined>(undefined);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "danger" | "warning"; text: string } | null>(null);
  const [seenUpTo, setSeenUpTo] = useState<number | null>(null);
  const thread = useQuery({ queryKey: key, queryFn: () => getThread(parentType, parentId), refetchInterval: 30_000, retry: false });
  const data = thread.data;
  // What was unread when the discussion was opened stays marked "New" for this visit; the discussion is then marked read.
  if (data && seenUpTo === null) setSeenUpTo(data.lastReadSequence);
  useEffect(() => {
    if (!data) return;
    if (data.newestSequence > data.lastReadSequence) {
      void markRead(parentType, parentId, data.newestSequence).then(() => queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "projects", "discussion-summary", parentType, parentId) })).catch(() => undefined);
    }
  }, [data, parentType, parentId, queryClient, workspace]);
  useEffect(() => {
    if (!focus || !data) return;
    document.getElementById(`comment-${focus}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focus, data]);
  const comments = useMemo(() => [...older, ...(data?.comments ?? [])], [older, data]);
  if (thread.isLoading) return <LoadingState label="Loading the discussion" rows={4} />;
  if (thread.isError || !data) return <Notice tone="danger">{errorMessage(thread.error)}</Notice>;
  const discussion = data.discussion;
  const changed = async (text: string) => {
    setMessage({ tone: text.startsWith("Posted, but") ? "warning" : "success", text });
    setOlder([]); setNextBefore(undefined);
    await queryClient.invalidateQueries({ queryKey: key });
    await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "projects", "discussion-summary", parentType, parentId) });
  };
  const loadOlder = async () => {
    const before = nextBefore === undefined ? data.nextBefore : nextBefore;
    if (!before) return;
    setLoadingOlder(true);
    try { const page = await getThread(parentType, parentId, before); setOlder((current) => [...page.comments, ...current]); setNextBefore(page.nextBefore); }
    catch (failure) { setMessage({ tone: "danger", text: errorMessage(failure) }); } finally { setLoadingOlder(false); }
  };
  const more = nextBefore === undefined ? data.hasMore : Boolean(nextBefore);
  const follow = async () => {
    try { await setSubscription(parentType, parentId, data.following ? "MUTED" : "FOLLOWING"); await queryClient.invalidateQueries({ queryKey: key }); }
    catch (failure) { setMessage({ tone: "danger", text: errorMessage(failure) }); }
  };
  const isNew = (comment: Comment) => seenUpTo !== null && comment.sequence > seenUpTo && !comment.mine;
  return (
    <Panel title={title} description={description ?? `The conversation about this ${discussion.kind.toLowerCase()}. Approvals, completion and status changes stay on their own actions.`}
      actions={<Button size="compact" variant="secondary" onPress={follow} aria-pressed={data.following}>{data.following ? "Following" : "Follow"}</Button>}>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {discussion.readOnly && <Notice tone="neutral">{discussion.readOnlyReason ?? "This discussion is read-only."}</Notice>}
      {more && <div className="flex justify-center"><Button size="compact" variant="ghost" isLoading={loadingOlder} onPress={loadOlder}>Show earlier comments</Button></div>}
      {comments.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-text-muted">
          {discussion.can.comment ? "No comments yet. Start the conversation — mention someone with @ to let them know." : "No comments yet."}
        </p>
      ) : (
        <ol className="flex flex-col gap-4">
          {comments.map((comment) => (
            <CommentItem key={comment.id} comment={comment} discussion={discussion} isNew={isNew(comment)} highlighted={focus === comment.id} onChanged={changed}>
              {(comment.replies ?? []).length > 0 && (
                <ol className="mt-3 flex flex-col gap-3 border-l-2 border-border pl-3 sm:pl-4">
                  {(comment.replies ?? []).map((reply) => <CommentItem key={reply.id} comment={reply} discussion={discussion} isNew={isNew(reply)} highlighted={focus === reply.id} onChanged={changed} />)}
                </ol>
              )}
            </CommentItem>
          ))}
        </ol>
      )}
      {discussion.can.comment && <Composer discussion={discussion} onDone={changed} />}
    </Panel>
  );
}
