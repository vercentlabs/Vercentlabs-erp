"use client";

// Projects — Comments and Collaboration in My Work: the comments that mention me, the discussions with something new, the ones I follow,
// recent conversation across my projects, and search. Every entry opens the discussion on its project, task or milestone; nothing here is
// shown that the reader could not open there. Also the collaboration reports and the company's comment policy.
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, EmptyState, ErrorState, PageHeader, PermissionState, Select, StatusBadge, Tab, TabList, Tabs, TextField } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorMessage, errorStatus } from "../api/projects-api";
import {
  discussionsExportHref, getCommentSettings, getFollowed, getInbox, getMentions, getUnread, saveCommentSettings, searchComments, type CommentSettings, type DiscussionItem, type FollowedItem, type Page,
} from "./collaboration-api";
import { relativeTime } from "./CommentThread";

const VIEWS = [{ id: "mentions", label: "Mentions" }, { id: "unread", label: "Unread" }, { id: "followed", label: "Following" }, { id: "recent", label: "Recent" }, { id: "search", label: "Search" }];
const KIND_TONE = { PROJECT: "info", TASK: "neutral", MILESTONE: "success" } as const;
const TYPES = [{ value: "", label: "Projects, tasks and milestones" }, { value: "PROJECT", label: "Projects" }, { value: "TASK", label: "Tasks" }, { value: "MILESTONE", label: "Milestones" }];

function CommentRow({ item }: { item: DiscussionItem }) {
  return (
    <li>
      <Link href={item.href} className="flex gap-3 rounded-lg px-3 py-3 hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-focus">
        <span className={`mt-1.5 size-2 shrink-0 rounded-full ${item.unread ? "bg-brand" : "bg-transparent"}`} aria-label={item.unread ? "Unread" : undefined} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
            <StatusBadge tone={KIND_TONE[item.parentType]}>{item.kind}</StatusBadge>
            <span className="truncate font-medium text-text">{item.parentLabel}</span>
            {item.parentType !== "PROJECT" && <span className="truncate">{item.projectLabel}</span>}
            {item.visibility === "RESTRICTED" && <StatusBadge tone="warning">Restricted</StatusBadge>}
          </span>
          <span className="mt-1 block text-sm"><span className="font-semibold">{item.author?.name ?? "Former user"}</span>{item.isReply ? " replied: " : ": "}<span className="text-text-secondary">{item.excerpt}</span></span>
          <span className="mt-0.5 block text-xs text-text-muted" title={formatDateTime(item.createdAt)}>{`${relativeTime(item.createdAt)}${item.attachmentCount ? ` · ${item.attachmentCount} file${item.attachmentCount === 1 ? "" : "s"}` : ""}${item.editedAt ? " · edited" : ""}`}</span>
        </span>
      </Link>
    </li>
  );
}
function DiscussionRow({ item }: { item: FollowedItem }) {
  return (
    <li>
      <Link href={item.href} className="flex gap-3 rounded-lg px-3 py-3 hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-focus">
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
            <StatusBadge tone={KIND_TONE[item.parentType]}>{item.kind}</StatusBadge>
            <span className="truncate font-medium text-text">{item.label}</span>
            {item.parentType !== "PROJECT" && <span className="truncate">{item.projectLabel}</span>}
          </span>
          <span className="mt-1 block truncate text-sm text-text-secondary">{`${item.lastAuthor ?? "Someone"}: ${item.lastExcerpt}`}</span>
          <span className="mt-0.5 block text-xs text-text-muted" title={formatDateTime(item.lastAt)}>{`${relativeTime(item.lastAt)} · ${item.total} comment${item.total === 1 ? "" : "s"}`}</span>
        </span>
        {item.unread > 0 && <span className="self-center rounded-full bg-brand px-2 py-0.5 text-xs font-semibold text-text-inverse">{`${item.unread} new`}</span>}
      </Link>
    </li>
  );
}
function Pager({ data, page, setPage }: { data: { total: number; pageSize: number }; page: number; setPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-2 pt-2 text-sm text-text-muted">
      <span>{`Page ${page} of ${pages}`}</span>
      <span className="flex gap-2"><Button size="compact" variant="secondary" isDisabled={page <= 1} onPress={() => setPage(page - 1)}>Previous</Button>
        <Button size="compact" variant="secondary" isDisabled={page >= pages} onPress={() => setPage(page + 1)}>Next</Button></span>
    </div>
  );
}

export function DiscussionsScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const view = VIEWS.some((row) => row.id === params.get("view")) ? params.get("view")! : "mentions";
  const [page, setPage] = useState(1);
  const [q, setQ] = useState(params.get("q") ?? "");
  const [submitted, setSubmitted] = useState(params.get("q") ?? "");
  const [type, setType] = useState("");
  const [files, setFiles] = useState(false);
  const inbox = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "discussion-inbox"), queryFn: getInbox, refetchInterval: 60_000, retry: false });
  const filters = { page, pageSize: 25, parentType: type || undefined, hasAttachments: files ? "true" : undefined };
  const list = useQuery({
    queryKey: scopedQueryKey(workspace, "projects", "discussions", view, page, submitted, type, files),
    queryFn: (): Promise<Page<DiscussionItem> | Page<FollowedItem>> => (view === "mentions" ? getMentions({ page, pageSize: 25 }) : view === "unread" ? getUnread({ page, pageSize: 25 })
      : view === "followed" ? getFollowed({ page, pageSize: 25 }) : searchComments({ ...filters, q: view === "search" ? submitted : undefined })),
    enabled: view !== "search" || submitted.trim().length > 0, retry: false,
  });
  if (list.isError && errorStatus(list.error) === 403) return <PermissionState title="You don't have access to project discussions" description="Ask an administrator for the View comments permission." />;
  const go = (next: string) => { setPage(1); router.replace(`${pathname}?view=${next}`, { scroll: false }); };
  const count = (id: string) => (id === "mentions" ? inbox.data?.mentions : id === "unread" ? inbox.data?.unreadDiscussions : undefined);
  const comments = view === "mentions" || view === "recent" || view === "search";
  const empty = {
    mentions: ["No mentions", "When someone mentions you in a project, task or milestone discussion, it appears here."],
    unread: ["You're all caught up", "New comments in the discussions you follow appear here."],
    followed: ["No followed discussions", "You follow the tasks assigned to you, the milestones you own, the projects you manage and every discussion you comment in."],
    recent: ["No recent comments", "Comments on the projects you can see appear here."],
    search: ["No matching comments", "Try other words, or widen the filters."],
  }[view]!;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Discussions" description="Conversation from your projects, tasks and milestones. Approvals and status changes stay on the records themselves." />
      <Tabs selectedKey={view} onSelectionChange={(key) => go(String(key))}>
        <TabList aria-label="Discussion views">
          {VIEWS.map((row) => (
            <Tab key={row.id} id={row.id}>
              <span className="inline-flex items-center gap-1.5">{row.label}{count(row.id) ? <span className="rounded-full bg-brand px-1.5 text-[11px] font-semibold leading-4 text-text-inverse">{count(row.id)}</span> : null}</span>
            </Tab>
          ))}
        </TabList>
      </Tabs>
      {(view === "search" || view === "recent") && (
        <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={(event) => { event.preventDefault(); setPage(1); setSubmitted(q); if (view !== "search") go("search"); }}>
          <div className="min-w-0 flex-1"><TextField label="Search comments" value={q} onChange={setQ} placeholder="Words in a comment" /></div>
          <div className="sm:w-60"><Select label="In" selectedKey={type} onSelectionChange={(key) => { setType(String(key ?? "")); setPage(1); }} options={TYPES} /></div>
          <Checkbox isSelected={files} onChange={(on) => { setFiles(on); setPage(1); }}>With files</Checkbox>
          <Button type="submit" variant="primary">Search</Button>
        </form>
      )}
      {view === "search" && !submitted.trim() ? <EmptyState title="Search the discussions" description="Only comments you may read are searched — restricted ones only if you are allowed to see them." />
        : list.isLoading ? <LoadingState label="Loading discussions" rows={6} />
        : list.isError || !list.data ? <ErrorState title="Could not load the discussions" description={errorMessage(list.error)} />
        : list.data.items.length === 0 ? <EmptyState title={empty[0]} description={empty[1]} />
        : (
          <Panel>
            <ul className="-mx-3 flex flex-col divide-y divide-border">
              {comments ? (list.data.items as DiscussionItem[]).map((item) => <CommentRow key={item.id} item={item} />)
                : (list.data.items as FollowedItem[]).map((item) => <DiscussionRow key={`${item.parentType}:${item.parentId}`} item={item} />)}
            </ul>
            <Pager data={list.data} page={page} setPage={setPage} />
          </Panel>
        )}
    </div>
  );
}

// ------------------------------------------------------------------ reports (a set of Project Reports)
export const COLLABORATION_REPORT_TABS = [{ id: "cm-recent", label: "Recent discussions" }, { id: "cm-by-project", label: "By project" }, { id: "cm-task-discussions", label: "Task discussions" },
  { id: "cm-milestone-discussions", label: "Milestone discussions" }, { id: "cm-unread-mentions", label: "My unread mentions" }, { id: "cm-with-attachments", label: "With attachments" },
  { id: "cm-restricted-audit", label: "Restricted audit" }, { id: "cm-edited-deleted", label: "Edited and removed" }];
type Row = Record<string, unknown>;
const s = (value: unknown) => (value === null || value === undefined ? "" : String(value));
export function CollaborationReport({ kind, rows }: { kind: string; rows: Row[] }) {
  switch (kind) {
    case "cm-recent": case "cm-unread-mentions": case "cm-with-attachments": case "cm-restricted-audit": return (
      <LinesTable columns={["Posted", "By", "On", "Comment", { label: "Files", numeric: true }]}>
        {(rows as unknown as DiscussionItem[]).map((row) => <tr key={row.id}><Cell>{formatDateTime(row.createdAt)}</Cell><Cell>{row.author?.name ?? "—"}</Cell>
          <Cell><Link className="text-brand underline" href={row.href}>{row.parentLabel}</Link><span className="block text-xs text-text-muted">{row.kind}{row.parentType !== "PROJECT" ? ` · ${row.projectLabel}` : ""}</span></Cell>
          <Cell><span className="line-clamp-2">{row.excerpt}</span></Cell><Cell numeric>{row.attachmentCount || "—"}</Cell></tr>)}
      </LinesTable>
    );
    case "cm-by-project": case "cm-task-discussions": case "cm-milestone-discussions": return (
      <LinesTable columns={[kind === "cm-by-project" ? "Project" : kind === "cm-task-discussions" ? "Task" : "Milestone", ...(kind === "cm-by-project" ? [] : ["Project"]), { label: "Comments", numeric: true },
        ...(kind === "cm-by-project" ? [{ label: "Discussions", numeric: true }] : []), { label: "Participants", numeric: true }, "Last comment"]}>
        {rows.map((row) => <tr key={s(row.key)}><Cell><Link className="text-brand underline" href={s(row.href)}>{s(row.label)}</Link></Cell>{kind !== "cm-by-project" && <Cell>{s(row.project)}</Cell>}
          <Cell numeric>{s(row.comments)}</Cell>{kind === "cm-by-project" && <Cell numeric>{s(row.discussions)}</Cell>}<Cell numeric>{s(row.participants)}</Cell><Cell>{formatDateTime(s(row.lastAt))}</Cell></tr>)}
      </LinesTable>
    );
    case "cm-edited-deleted": return (
      <LinesTable columns={["When", "Change", "By", "Author", "On", { label: "Versions", numeric: true }, "Reason"]}>
        {rows.map((row) => <tr key={s(row.id)}><Cell>{formatDateTime(s(row.at))}</Cell><Cell>{s(row.change)}</Cell><Cell>{s(row.by) || "—"}</Cell><Cell>{s(row.author) || "—"}</Cell>
          <Cell><Link className="text-brand underline" href={s(row.href)}>{s(row.parentLabel)}</Link></Cell><Cell numeric>{s(row.versions)}</Cell><Cell>{s(row.reason) || "—"}</Cell></tr>)}
      </LinesTable>
    );
    default: return null;
  }
}
export const collaborationExportHref = () => discussionsExportHref({});

// ------------------------------------------------------------------ the company's comment policy (Project Settings)
export function CommentSettingsPanel() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "comment-settings"), queryFn: getCommentSettings, retry: false });
  const [draft, setDraft] = useState<Partial<CommentSettings> | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (settings.isLoading) return <LoadingState label="Loading the comment policy" rows={2} />;
  if (!settings.data) return errorStatus(settings.error) === 403 ? null : <Notice tone="danger">{errorMessage(settings.error)}</Notice>;
  const value = { ...settings.data, ...draft };
  const manage = settings.data.can.manage;
  const save = async () => {
    setBusy(true); setMessage(null);
    try { await saveCommentSettings({ editWindowMinutes: value.editWindowMinutes, maxLength: value.maxLength }); await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "projects") }); setDraft(null); setMessage({ tone: "success", text: "Comment policy saved." }); }
    catch (failure) { setMessage({ tone: "danger", text: errorMessage(failure) }); } finally { setBusy(false); }
  };
  return (
    <Panel title="Comments" description="How long people may edit their own comments, and how long a comment may be. Every edit keeps the previous version.">
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Edit window (hours)" isDisabled={!manage} inputMode="decimal" value={String(value.editWindowMinutes / 60)}
          onChange={(next) => setDraft({ ...draft, editWindowMinutes: Math.round(Number(next) * 60) })} description="0 means comments cannot be edited once posted." />
        <TextField label="Longest comment (characters)" isDisabled={!manage} inputMode="numeric" value={String(value.maxLength)} onChange={(next) => setDraft({ ...draft, maxLength: Number(next) })}
          description="Between 200 and 20,000." />
      </div>
      {manage && <div className="flex justify-end"><Button variant="primary" isLoading={busy} isDisabled={busy || !draft} onPress={save}>Save comment policy</Button></div>}
    </Panel>
  );
}
