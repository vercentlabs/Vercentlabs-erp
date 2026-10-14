"use client";

// To-dos › Notes and To-dos › Files: find a note or a file without remembering which record holds it. They list what is on the leads,
// companies, contacts and deals the user can see; notes are written and files uploaded on the record itself, which each row opens.
import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Download, Eye, Pin } from "lucide-react";
import { Badge, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, IconButton, NoResultsState, SearchField, Select } from "@vercentlabs/design-system";

import { FilePreviewDialog } from "@/features/crm/attachments/components/FilePreviewDialog";
import { DateInput } from "@/features/crm/shared/ui/DateTimeInput";
import { FiltersPopover } from "@/features/crm/shared/ui/FiltersPopover";
import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { RELATED_TYPE_LABELS, attachmentDownloadUrl, errorMessage, formatSize, relatedRecordHref, searchAttachments, searchNotes, type LibraryAttachment } from "../api/notes-api";

const ANY = "any";
const RELATED_OPTIONS = [{ value: ANY, label: "All records" }, { value: "lead", label: "Leads" }, { value: "party", label: "Companies" }, { value: "contact", label: "Contacts" }, { value: "opportunity", label: "Deals" }];
const KIND_OPTIONS = [
  { value: ANY, label: "All files" }, { value: "document", label: "Documents and PDFs" }, { value: "spreadsheet", label: "Spreadsheets" },
  { value: "presentation", label: "Presentations" }, { value: "image", label: "Images" }, { value: "other", label: "Other" },
];
const KIND_LABELS: Record<string, string> = { document: "Document", spreadsheet: "Spreadsheet", presentation: "Presentation", image: "Image", other: "Other" };

function RelatedLink({ type, id, name, tab }: { type: string; id: string; name: string | null; tab: "notes" | "attachments" }) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Badge tone="neutral">{RELATED_TYPE_LABELS[type] ?? type}</Badge>
      <Link href={relatedRecordHref(type, id, tab)} className="font-medium text-brand underline-offset-2 hover:underline">{name ?? "Open record"}</Link>
    </span>
  );
}

// tabs: the To-dos tab row, drawn under the page title.
export function NotesSearchScreen({ tabs }: { tabs?: ReactNode } = {}) {
  const workspace = useWorkspaceContext();
  const [search, setSearch] = useState("");
  const [relatedType, setRelatedType] = useState(ANY);
  const [pinned, setPinned] = useState(ANY);
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const filters = { search: search.trim() || undefined, relatedType: relatedType === ANY ? undefined : relatedType, pinned: pinned === "yes" ? "yes" : undefined, createdFrom: createdFrom || undefined, createdTo: createdTo || undefined };
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "notes", "library", filters), queryFn: () => searchNotes(filters) });
  const notes = query.data?.notes ?? [];
  const active = [relatedType !== ANY, pinned !== ANY, Boolean(createdFrom), Boolean(createdTo)].filter(Boolean).length;
  return (
    <EnterpriseListPage
      tabs={tabs}
      header={{ title: tabs ? "To-dos" : "Notes", description: "Every note on the records you can see. Notes are added on the lead, company, contact or deal they belong to." }}
      actionBar={{
        start: (
          <>
            <SearchField aria-label="Search notes" placeholder="Search title or text" className="w-full sm:w-80" value={search} onChange={setSearch} />
            <FiltersPopover active={active} onClear={() => { setRelatedType(ANY); setPinned(ANY); setCreatedFrom(""); setCreatedTo(""); }}>
              <Select label="Related to" selectedKey={relatedType} onSelectionChange={(key) => setRelatedType(String(key))} options={RELATED_OPTIONS} />
              <Select label="Pinned" selectedKey={pinned} onSelectionChange={(key) => setPinned(String(key))} options={[{ value: ANY, label: "All notes" }, { value: "yes", label: "Pinned only" }]} />
              <DateInput label="Created from" value={createdFrom} onChange={setCreatedFrom} />
              <DateInput label="Created to" value={createdTo} onChange={setCreatedTo} />
            </FiltersPopover>
          </>
        ),
      }}
    >
      {query.isLoading ? <LoadingState label="Loading notes" rows={4} />
        : query.isError ? <p role="alert" className="text-sm text-danger">{errorMessage(query.error, "The notes could not be loaded.")}</p>
        : notes.length === 0 ? <EmptyState title="No notes found" description="Try a different search or filter." />
        : (
          <>
            <p className="text-sm text-text-secondary">{query.data!.total} {query.data!.total === 1 ? "note" : "notes"}{query.data!.total > notes.length ? `, showing the newest ${notes.length}` : ""}</p>
            <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface text-sm">
              {notes.map((note) => (
                <li key={note.id} className="flex flex-col gap-1 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <RelatedLink type={note.relatedType} id={note.relatedId} name={note.relatedName} tab="notes" />
                    {note.isPinned && <span className="inline-flex items-center gap-1 text-xs text-text-secondary"><Pin className="size-3" aria-hidden="true" />Pinned</span>}
                    {note.visibility === "private" && <Badge tone="neutral">Private</Badge>}
                  </div>
                  {note.title && <span className="font-semibold">{note.title}</span>}
                  <p className="line-clamp-3 whitespace-pre-wrap text-text-secondary">{note.bodyText}</p>
                  <span className="text-xs text-text-muted">{[note.createdByName, formatDateTime(note.createdAt), note.attachmentCount ? `${note.attachmentCount} file${note.attachmentCount === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ")}</span>
                </li>
              ))}
            </ul>
          </>
        )}
    </EnterpriseListPage>
  );
}

export function FilesSearchScreen({ tabs }: { tabs?: ReactNode } = {}) {
  const workspace = useWorkspaceContext();
  const [search, setSearch] = useState("");
  const [relatedType, setRelatedType] = useState(ANY);
  const [kind, setKind] = useState(ANY);
  const [preview, setPreview] = useState<LibraryAttachment | null>(null);
  const filters = { search: search.trim() || undefined, relatedType: relatedType === ANY ? undefined : relatedType, kind: kind === ANY ? undefined : kind };
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "attachments", "library", filters), queryFn: () => searchAttachments(filters) });
  const files = query.data?.attachments ?? [];
  const columns = useMemo<ColumnDef<LibraryAttachment, unknown>[]>(() => [
    { id: "fileName", accessorKey: "fileName", header: "File", enableHiding: false, cell: ({ row }) => (
      <span className="flex min-w-48 flex-col"><span className="font-medium break-words">{row.original.fileName}</span>
        {row.original.description && <span className="text-xs text-text-secondary">{row.original.description}</span>}</span>) },
    { id: "related", header: "Related to", enableSorting: false, cell: ({ row }) => <RelatedLink type={row.original.relatedType} id={row.original.relatedId} name={row.original.relatedName} tab="attachments" /> },
    { id: "kind", accessorKey: "kind", header: "Type", cell: ({ row }) => KIND_LABELS[row.original.kind] ?? row.original.kind },
    { id: "size", accessorKey: "sizeBytes", header: "Size", cell: ({ row }) => <span className="tabular-nums">{formatSize(row.original.sizeBytes)}</span> },
    { id: "uploadedBy", accessorKey: "uploadedByName", header: "Uploaded by", cell: ({ row }) => row.original.uploadedByName ?? "–" },
    { id: "uploadedAt", accessorKey: "uploadedAt", header: "Uploaded", cell: ({ row }) => formatDateTime(row.original.uploadedAt) },
    { id: "actions", header: "", enableSorting: false, enableHiding: false, cell: ({ row }) => row.original.canDownload ? (
      <span className="flex items-center gap-1" onClick={(event) => event.stopPropagation()} role="presentation">
        {row.original.preview && <IconButton aria-label={`Preview ${row.original.fileName}`} size="compact" variant="ghost" onPress={() => setPreview(row.original)}><Eye className="size-4" aria-hidden="true" /></IconButton>}
        <a href={attachmentDownloadUrl(row.original.id)} aria-label={`Download ${row.original.fileName}`} title="Download"
          className="inline-flex size-8 items-center justify-center rounded-[var(--radius-control)] text-text-secondary hover:bg-surface-hover hover:text-text"><Download className="size-4" aria-hidden="true" /></a>
      </span>
    ) : null },
  ], []);
  const active = [relatedType !== ANY, kind !== ANY].filter(Boolean).length;
  return (
    <EnterpriseListPage
      tabs={tabs}
      header={{ title: tabs ? "To-dos" : "Files", description: "Every file on the records you can see. Files are uploaded on the lead, company, contact or deal they belong to." }}
      actionBar={{
        start: (
          <>
            <SearchField aria-label="Search files" placeholder="Search file name or description" className="w-full sm:w-80" value={search} onChange={setSearch} />
            <FiltersPopover active={active} onClear={() => { setRelatedType(ANY); setKind(ANY); }}>
              <Select label="Related to" selectedKey={relatedType} onSelectionChange={(key) => setRelatedType(String(key))} options={RELATED_OPTIONS} />
              <Select label="Type" selectedKey={kind} onSelectionChange={(key) => setKind(String(key))} options={KIND_OPTIONS} />
            </FiltersPopover>
          </>
        ),
      }}
    >
      <EnterpriseDataGrid<LibraryAttachment>
        aria-label="Files"
        columns={columns}
        data={files}
        getRowId={(row) => row.id}
        state={query.isLoading ? "loading" : query.isError ? "error" : files.length === 0 ? (search || active ? "no-results" : "empty") : "ready"}
        loadingContent={<LoadingState label="Loading files" rows={6} />}
        errorContent={<ErrorState title="Could not load the files" description={errorMessage(query.error, "Try again.")} action={{ label: "Try again", onPress: () => void query.refetch() }} />}
        emptyContent={<EmptyState title="No files yet" description="Upload files on the lead, company, contact or deal they belong to." />}
        noResultsContent={<NoResultsState title="No files found" description="Try a different search or filter." />}
        renderMobileCard={(row) => <span className="flex flex-col gap-1"><span className="font-medium">{row.fileName}</span><span className="text-xs text-text-secondary">{row.relatedName ?? ""} · {formatSize(row.sizeBytes)}</span></span>}
      />
      {preview && <FilePreviewDialog file={preview} onClose={() => setPreview(null)} />}
    </EnterpriseListPage>
  );
}
