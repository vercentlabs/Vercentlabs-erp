"use client";

// To-dos › Notes and To-dos › Files: find a note or a file without remembering which record holds it. They list what is on the leads,
// companies, contacts and deals the user can see; notes are written and files uploaded on the record itself, which each row opens. Like
// tasks and follow-ups, a row of coloured, counted cards picks the kind of record (All · Leads · Companies · Contacts · Deals).
import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import Link from "next/link";
import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Building2, Contact, Download, Eye, File, FileImage, FileSpreadsheet, FileText, Files, Handshake, Pin, Presentation, StickyNote, UserPlus,
} from "lucide-react";
import { Badge, Button, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, IconButton, NoResultsState, SearchField, Select } from "@vercentlabs/design-system";

import { FilePreviewDialog } from "@/features/crm/attachments/components/FilePreviewDialog";
import { DateInput } from "@/features/crm/shared/ui/DateTimeInput";
import { FiltersPopover } from "@/features/crm/shared/ui/FiltersPopover";
import { QueueCards, type QueueCard, type QueueTone } from "@/features/crm/shared/ui/WorkQueues";
import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { RELATED_TYPE_LABELS, attachmentDownloadUrl, errorMessage, formatSize, relatedRecordHref, searchAttachments, searchNotes, type LibraryAttachment } from "../api/notes-api";

const ANY = "any";
const NOTES_PAGE = 50;
type RecordKind = typeof ANY | "lead" | "party" | "contact" | "opportunity";
// One colour per kind of record, the same on the cards and on each row's record badge.
const RECORD_TONES: Record<string, Exclude<QueueTone, "neutral" | "danger">> = { lead: "info", party: "brand", contact: "success", opportunity: "warning" };
const recordCards = (all: string, allIcon: ComponentType<{ className?: string }>): Array<Omit<QueueCard<RecordKind>, "count">> => [
  { key: ANY, label: all, tone: "neutral", icon: allIcon },
  { key: "lead", label: "Leads", tone: "info", icon: UserPlus },
  { key: "party", label: "Companies", tone: "brand", icon: Building2 },
  { key: "contact", label: "Contacts", tone: "success", icon: Contact },
  { key: "opportunity", label: "Deals", tone: "warning", icon: Handshake },
];
const KIND_OPTIONS = [
  { value: ANY, label: "All files" }, { value: "document", label: "Documents and PDFs" }, { value: "spreadsheet", label: "Spreadsheets" },
  { value: "presentation", label: "Presentations" }, { value: "image", label: "Images" }, { value: "other", label: "Other" },
];
const KIND_LABELS: Record<string, string> = { document: "Document", spreadsheet: "Spreadsheet", presentation: "Presentation", image: "Image", other: "Other" };
const KIND_STYLE: Record<string, { icon: ComponentType<{ className?: string }>; className: string }> = {
  document: { icon: FileText, className: "bg-danger-soft text-danger" },
  spreadsheet: { icon: FileSpreadsheet, className: "bg-success-soft text-success" },
  presentation: { icon: Presentation, className: "bg-warning-soft text-warning" },
  image: { icon: FileImage, className: "bg-info-soft text-info" },
  other: { icon: File, className: "bg-canvas-strong text-text-secondary" },
};

function useDebounced(value: string) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), 300);
    return () => clearTimeout(timer);
  }, [value]);
  return settled;
}

function RelatedLink({ type, id, name, tab }: { type: string; id: string; name: string | null; tab: "notes" | "attachments" }) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Badge tone={RECORD_TONES[type] ?? "neutral"}>{RELATED_TYPE_LABELS[type] ?? type}</Badge>
      <Link href={relatedRecordHref(type, id, tab)} className="font-medium text-brand underline-offset-2 hover:underline" onClick={(event) => event.stopPropagation()}>{name ?? "Open record"}</Link>
    </span>
  );
}

const initials = (name: string | null) => (name ?? "?").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";

// tabs: the To-dos tab row, drawn under the page title.
export function NotesSearchScreen({ tabs }: { tabs?: ReactNode } = {}) {
  const workspace = useWorkspaceContext();
  const [search, setSearch] = useState("");
  const settledSearch = useDebounced(search.trim());
  const [relatedType, setRelatedTypeState] = useState<RecordKind>(ANY);
  const [pinned, setPinned] = useState(ANY);
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const narrowing = { search: settledSearch || undefined, pinned: pinned === "yes" ? "yes" : undefined, createdFrom: createdFrom || undefined, createdTo: createdTo || undefined };
  // The page belongs to one search and set of filters: any change starts again at the first page.
  const pageKey = JSON.stringify([narrowing, relatedType]);
  const [paging, setPaging] = useState({ key: pageKey, page: 0 });
  const page = paging.key === pageKey ? paging.page : 0;
  const setPage = (next: number) => setPaging({ key: pageKey, page: next });
  const setRelatedType = (next: RecordKind) => setRelatedTypeState(next);
  const filters = { ...narrowing, relatedType: relatedType === ANY ? undefined : relatedType, limit: NOTES_PAGE, offset: page * NOTES_PAGE };
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "notes", "library", filters), queryFn: () => searchNotes(filters), placeholderData: keepPreviousData });
  const cards = recordCards("All notes", StickyNote);
  const counts = useQueries({
    queries: cards.map((card) => {
      const countFilters = { ...narrowing, relatedType: card.key === ANY ? undefined : card.key, limit: 1 };
      return { queryKey: scopedQueryKey(workspace, "crm", "notes", "library", "count", countFilters), queryFn: () => searchNotes(countFilters), placeholderData: keepPreviousData };
    }),
  });
  const notes = query.data?.notes ?? [];
  const total = query.data?.total ?? 0;
  const active = [pinned !== ANY, Boolean(createdFrom), Boolean(createdTo)].filter(Boolean).length;
  return (
    <EnterpriseListPage
      tabs={tabs}
      header={{ title: tabs ? "To-dos" : "Notes", description: "Every note on the records you can see. Notes are added on the lead, company, contact or deal they belong to." }}
      actionBar={{
        start: (
          <>
            <SearchField aria-label="Search notes" placeholder="Search title or text" className="w-full sm:w-80" value={search} onChange={setSearch} />
            <FiltersPopover active={active} onClear={() => { setPinned(ANY); setCreatedFrom(""); setCreatedTo(""); }}>
              <Select label="Pinned" selectedKey={pinned} onSelectionChange={(key) => setPinned(String(key))} options={[{ value: ANY, label: "All notes" }, { value: "yes", label: "Pinned only" }]} />
              <DateInput label="Created from" value={createdFrom} onChange={setCreatedFrom} />
              <DateInput label="Created to" value={createdTo} onChange={setCreatedTo} />
            </FiltersPopover>
          </>
        ),
      }}
    >
      <div className="flex flex-col gap-4">
        <QueueCards<RecordKind> label="Notes by record" cards={cards.map((card, index) => ({ ...card, count: counts[index]?.data?.total }))} value={relatedType} onChange={setRelatedType} />
        {query.isLoading ? <LoadingState label="Loading notes" rows={4} />
          : query.isError ? <ErrorState title="Could not load the notes" description={errorMessage(query.error, "Try again.")} action={{ label: "Try again", onPress: () => void query.refetch() }} />
          : notes.length === 0 ? (settledSearch || active || relatedType !== ANY
            ? <NoResultsState title="No notes found" description="Try a different search, card or filter." />
            : <EmptyState title="No notes yet" description="Add notes on the lead, company, contact or deal they belong to." />)
          : (
            <>
              <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface text-sm">
                {notes.map((note) => (
                  <li key={note.id} className="flex gap-3 px-4 py-3 transition-colors hover:bg-surface-hover">
                    <span className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${{ info: "bg-info-soft text-info", brand: "bg-brand-soft text-brand", success: "bg-success-soft text-success", warning: "bg-warning-soft text-warning" }[RECORD_TONES[note.relatedType] ?? "brand"]}`}
                      aria-hidden="true">{initials(note.createdByName)}</span>
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <RelatedLink type={note.relatedType} id={note.relatedId} name={note.relatedName} tab="notes" />
                        {note.isPinned && <Badge tone="warning"><Pin className="size-3" aria-hidden="true" />Pinned</Badge>}
                        {note.visibility === "private" && <Badge tone="neutral">Private</Badge>}
                      </div>
                      {note.title && <span className="font-semibold text-text">{note.title}</span>}
                      <p className="line-clamp-3 whitespace-pre-wrap text-text-secondary">{note.bodyText}</p>
                      <span className="text-xs text-text-muted">{[note.createdByName, formatDateTime(note.createdAt), note.attachmentCount ? `${note.attachmentCount} file${note.attachmentCount === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ")}</span>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-text-secondary">
                <span className="tabular-nums">{page * NOTES_PAGE + 1}–{page * NOTES_PAGE + notes.length} of {total} {total === 1 ? "note" : "notes"}</span>
                {total > NOTES_PAGE && (
                  <span className="flex gap-2">
                    <Button variant="outline" size="compact" isDisabled={page === 0} onPress={() => setPage(page - 1)}>Previous</Button>
                    <Button variant="outline" size="compact" isDisabled={(page + 1) * NOTES_PAGE >= total} onPress={() => setPage(page + 1)}>Next</Button>
                  </span>
                )}
              </div>
            </>
          )}
      </div>
    </EnterpriseListPage>
  );
}

export function FilesSearchScreen({ tabs }: { tabs?: ReactNode } = {}) {
  const workspace = useWorkspaceContext();
  const [search, setSearch] = useState("");
  const settledSearch = useDebounced(search.trim());
  const [relatedType, setRelatedType] = useState<RecordKind>(ANY);
  const [kind, setKind] = useState(ANY);
  const [preview, setPreview] = useState<LibraryAttachment | null>(null);
  const narrowing = { search: settledSearch || undefined, kind: kind === ANY ? undefined : kind };
  const filters = { ...narrowing, relatedType: relatedType === ANY ? undefined : relatedType, limit: 100 };
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "attachments", "library", filters), queryFn: () => searchAttachments(filters), placeholderData: keepPreviousData });
  const cards = recordCards("All files", Files);
  const counts = useQueries({
    queries: cards.map((card) => {
      const countFilters = { ...narrowing, relatedType: card.key === ANY ? undefined : card.key, limit: 1 };
      return { queryKey: scopedQueryKey(workspace, "crm", "attachments", "library", "count", countFilters), queryFn: () => searchAttachments(countFilters), placeholderData: keepPreviousData };
    }),
  });
  const files = query.data?.attachments ?? [];
  const columns = useMemo<ColumnDef<LibraryAttachment, unknown>[]>(() => [
    {
      id: "fileName", accessorKey: "fileName", header: "File", enableHiding: false,
      cell: ({ row }) => {
        const file = row.original;
        const style = KIND_STYLE[file.kind] ?? KIND_STYLE.other;
        const Icon = style.icon;
        return (
          <span className="flex min-w-64 items-center gap-3">
            <span className={`flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] ${style.className}`} title={KIND_LABELS[file.kind] ?? file.kind}><Icon className="size-4" aria-hidden="true" /></span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="font-medium break-words text-text">{file.fileName}</span>
              <span className="text-xs text-text-muted">{[KIND_LABELS[file.kind] ?? file.kind, formatSize(file.sizeBytes), file.description].filter(Boolean).join(" · ")}</span>
            </span>
            {/* Next to the name, so they stay in reach however narrow the screen. */}
            {file.canDownload && (
              <span className="flex shrink-0 items-center gap-1" onClick={(event) => event.stopPropagation()} role="presentation">
                {file.preview && <IconButton aria-label={`Preview ${file.fileName}`} size="compact" variant="ghost" onPress={() => setPreview(file)}><Eye className="size-4" aria-hidden="true" /></IconButton>}
                <a href={attachmentDownloadUrl(file.id)} aria-label={`Download ${file.fileName}`} title="Download"
                  className="inline-flex size-8 items-center justify-center rounded-[var(--radius-control)] text-text-secondary hover:bg-surface-hover hover:text-brand"><Download className="size-4" aria-hidden="true" /></a>
              </span>
            )}
          </span>
        );
      },
    },
    { id: "related", header: "Related to", enableSorting: false, cell: ({ row }) => <RelatedLink type={row.original.relatedType} id={row.original.relatedId} name={row.original.relatedName} tab="attachments" /> },
    { id: "uploadedBy", accessorKey: "uploadedByName", header: "Uploaded by", cell: ({ row }) => <span className="whitespace-nowrap">{row.original.uploadedByName ?? "–"}</span> },
    { id: "uploadedAt", accessorKey: "uploadedAt", header: "Uploaded", cell: ({ row }) => <span className="whitespace-nowrap">{formatDateTime(row.original.uploadedAt)}</span> },
  ], []);
  const active = kind !== ANY ? 1 : 0;
  return (
    <EnterpriseListPage
      tabs={tabs}
      header={{ title: tabs ? "To-dos" : "Files", description: "Every file on the records you can see. Files are uploaded on the lead, company, contact or deal they belong to." }}
      actionBar={{
        start: (
          <>
            <SearchField aria-label="Search files" placeholder="Search file name or description" className="w-full sm:w-80" value={search} onChange={setSearch} />
            <FiltersPopover active={active} onClear={() => setKind(ANY)}>
              <Select label="Type" selectedKey={kind} onSelectionChange={(key) => setKind(String(key))} options={KIND_OPTIONS} />
            </FiltersPopover>
          </>
        ),
      }}
    >
      <div className="flex flex-col gap-4">
        <QueueCards<RecordKind> label="Files by record" cards={cards.map((card, index) => ({ ...card, count: counts[index]?.data?.total }))} value={relatedType} onChange={setRelatedType} />
        <EnterpriseDataGrid<LibraryAttachment>
          aria-label="Files"
          columns={columns}
          data={files}
          getRowId={(row) => row.id}
          state={query.isLoading ? "loading" : query.isError ? "error" : files.length === 0 ? (settledSearch || active || relatedType !== ANY ? "no-results" : "empty") : "ready"}
          loadingContent={<LoadingState label="Loading files" rows={6} />}
          errorContent={<ErrorState title="Could not load the files" description={errorMessage(query.error, "Try again.")} action={{ label: "Try again", onPress: () => void query.refetch() }} />}
          emptyContent={<EmptyState title="No files yet" description="Upload files on the lead, company, contact or deal they belong to." />}
          noResultsContent={<NoResultsState title="No files found" description="Try a different search, card or filter." />}
          renderMobileCard={(row) => {
            const style = KIND_STYLE[row.kind] ?? KIND_STYLE.other;
            const Icon = style.icon;
            return (
              <span className="flex items-start gap-3">
                <span className={`flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] ${style.className}`}><Icon className="size-4" aria-hidden="true" /></span>
                <span className="flex min-w-0 flex-col gap-1"><span className="font-medium">{row.fileName}</span><span className="text-xs text-text-secondary">{row.relatedName ?? ""} · {formatSize(row.sizeBytes)}</span></span>
              </span>
            );
          }}
        />
        {(query.data?.total ?? 0) > files.length && <p className="text-xs text-text-muted">Showing the newest {files.length} of {query.data?.total}. Search or pick a card to narrow the list.</p>}
      </div>
      {preview && <FilePreviewDialog file={preview} onClose={() => setPreview(null)} />}
    </EnterpriseListPage>
  );
}
