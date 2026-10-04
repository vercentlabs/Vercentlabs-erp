"use client";

// Notes & Files: find a note or a file without remembering which record
// holds it. It lists what is on the leads, accounts, contacts and
// opportunities the user can see; notes and files are still written and
// uploaded on the record itself, which each row links to.
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Download, Pin } from "lucide-react";
import { Badge, EmptyState, PageHeader, Select, Tab, TabList, TabPanel, Tabs, TextField } from "@vercentlabs/design-system";

import { DateInput } from "@/features/crm/shared/ui/DateTimeInput";
import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { RELATED_TYPE_LABELS, attachmentDownloadUrl, errorMessage, formatSize, relatedRecordHref, searchAttachments, searchNotes } from "../api/notes-api";

const ANY = "any";
const RELATED_OPTIONS = [{ value: ANY, label: "All records" }, { value: "lead", label: "Leads" }, { value: "party", label: "Accounts" }, { value: "contact", label: "Contacts" }, { value: "opportunity", label: "Opportunities" }];
const KIND_OPTIONS = [
  { value: ANY, label: "All files" }, { value: "document", label: "Documents and PDFs" }, { value: "spreadsheet", label: "Spreadsheets" },
  { value: "presentation", label: "Presentations" }, { value: "image", label: "Images" }, { value: "other", label: "Other" },
];
const KIND_LABELS: Record<string, string> = { document: "Document", spreadsheet: "Spreadsheet", presentation: "Presentation", image: "Image", other: "Other" };

export function NotesFilesScreen() {
  return (
    <div className="flex flex-1 flex-col gap-4">
      <PageHeader title="Notes & Files" description="Every note and file on the records you can see. Add them on the lead, account, contact or opportunity they belong to." />
      <Tabs defaultSelectedKey="notes">
        <TabList aria-label="Notes and files">
          <Tab id="notes">Notes</Tab>
          <Tab id="files">Files</Tab>
        </TabList>
        <TabPanel id="notes"><NotesList /></TabPanel>
        <TabPanel id="files"><FilesList /></TabPanel>
      </Tabs>
    </div>
  );
}

function RelatedLink({ type, id, name, tab }: { type: string; id: string; name: string | null; tab: "notes" | "attachments" }) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Badge tone="neutral">{RELATED_TYPE_LABELS[type] ?? type}</Badge>
      <Link href={relatedRecordHref(type, id, tab)} className="font-medium text-brand underline-offset-2 hover:underline">{name ?? "Open record"}</Link>
    </span>
  );
}

function NotesList() {
  const workspace = useWorkspaceContext();
  const [search, setSearch] = useState("");
  const [relatedType, setRelatedType] = useState(ANY);
  const [pinned, setPinned] = useState(ANY);
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const filters = { search: search.trim() || undefined, relatedType: relatedType === ANY ? undefined : relatedType, pinned: pinned === "yes" ? "yes" : undefined, createdFrom: createdFrom || undefined, createdTo: createdTo || undefined };
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "notes", "library", filters), queryFn: () => searchNotes(filters) });
  const notes = query.data?.notes ?? [];
  return (
    <section className="flex flex-col gap-3 pt-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <TextField className="lg:col-span-2" label="Search notes" value={search} onChange={setSearch} placeholder="Title or text" />
        <Select label="Related to" selectedKey={relatedType} onSelectionChange={(key) => setRelatedType(String(key))} options={RELATED_OPTIONS} />
        <DateInput label="Created from" value={createdFrom} onChange={setCreatedFrom} />
        <DateInput label="Created to" value={createdTo} onChange={setCreatedTo} />
        <Select label="Pinned" selectedKey={pinned} onSelectionChange={(key) => setPinned(String(key))} options={[{ value: ANY, label: "All notes" }, { value: "yes", label: "Pinned only" }]} />
      </div>
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
    </section>
  );
}

function FilesList() {
  const workspace = useWorkspaceContext();
  const [search, setSearch] = useState("");
  const [relatedType, setRelatedType] = useState(ANY);
  const [kind, setKind] = useState(ANY);
  const filters = { search: search.trim() || undefined, relatedType: relatedType === ANY ? undefined : relatedType, kind: kind === ANY ? undefined : kind };
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "attachments", "library", filters), queryFn: () => searchAttachments(filters) });
  const files = query.data?.attachments ?? [];
  return (
    <section className="flex flex-col gap-3 pt-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <TextField className="lg:col-span-2" label="Search files" value={search} onChange={setSearch} placeholder="File name or description" />
        <Select label="Related to" selectedKey={relatedType} onSelectionChange={(key) => setRelatedType(String(key))} options={RELATED_OPTIONS} />
        <Select label="Type" selectedKey={kind} onSelectionChange={(key) => setKind(String(key))} options={KIND_OPTIONS} />
      </div>
      {query.isLoading ? <LoadingState label="Loading files" rows={4} />
        : query.isError ? <p role="alert" className="text-sm text-danger">{errorMessage(query.error, "The files could not be loaded.")}</p>
        : files.length === 0 ? <EmptyState title="No files found" description="Try a different search or filter." />
        : (
          <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border bg-surface">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-text-secondary">
                <tr>{["Filename", "Related to", "Type", "Size", "Uploaded by", "Uploaded at", ""].map((heading) => <th key={heading} scope="col" className="px-3 py-2 font-medium">{heading}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-border">
                {files.map((file) => (
                  <tr key={file.id}>
                    <th scope="row" className="max-w-xs px-3 py-2 font-medium"><span className="break-words">{file.fileName}</span>{file.description ? <span className="block text-xs font-normal text-text-secondary">{file.description}</span> : null}</th>
                    <td className="px-3 py-2"><RelatedLink type={file.relatedType} id={file.relatedId} name={file.relatedName} tab="attachments" /></td>
                    <td className="px-3 py-2">{KIND_LABELS[file.kind] ?? file.kind}</td>
                    <td className="px-3 py-2 tabular-nums">{formatSize(file.sizeBytes)}</td>
                    <td className="px-3 py-2">{file.uploadedByName ?? "–"}</td>
                    <td className="px-3 py-2">{formatDateTime(file.uploadedAt)}</td>
                    <td className="px-3 py-2">
                      {file.canDownload && (
                        <a href={attachmentDownloadUrl(file.id)} aria-label={`Download ${file.fileName}`} title="Download" className="inline-flex size-8 items-center justify-center rounded-[var(--radius-control)] text-text-secondary hover:bg-surface-hover hover:text-text">
                          <Download className="size-4" aria-hidden="true" />
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </section>
  );
}
