"use client";

// The companies a person works or worked for. One is the primary company;
// leaving a company keeps the link as history.
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertDialog, Badge, Button, Checkbox, Dialog, EmptyState, Select, TextField } from "@vercentlabs/design-system";

import { AccountPicker } from "@/features/crm/accounts/components/AccountPicker";
import { formatDate } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  errorMessage, linkContactAccount, listContactAccounts, setContactPrimaryAccount, updateContactAccount, type Contact, type ContactAccountLink, type ContactOptions,
} from "../api/contacts-api";
import { ErrorBanner } from "../contact-format";

const NO_ROLE = "";

export function ContactCompaniesPanel({ contact, options, canEdit }: { contact: Contact; options: ContactOptions; canEdit: boolean }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "contact", contact.id, "accounts"), queryFn: () => listContactAccounts(contact.id) });
  const [editing, setEditing] = useState<ContactAccountLink | "new" | null>(null);
  const [leaving, setLeaving] = useState<ContactAccountLink | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "contact", contact.id) });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "contacts") });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "account") });
  };
  const action = useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onSuccess: () => { setError(null); setLeaving(null); refresh(); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  const links = query.data ?? [];
  const roleLabel = (code: string | null) => options.roles.find((role) => role.code === code)?.label ?? null;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Companies</h2>
        {canEdit && <Button variant="primary" size="compact" onPress={() => setEditing("new")}>Link to a company</Button>}
      </div>
      <ErrorBanner message={error} />
      {query.isLoading ? <LoadingState label="Loading companies" rows={2} /> : links.length === 0 ? (
        <EmptyState title="No company yet" description="Link this person to the account they work for. Someone can be linked to more than one company." />
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface">
          {links.map((link) => (
            <li key={link.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/crm/accounts/${link.accountId}`} className="font-medium hover:underline">{link.accountName}</Link>
                  <span className="text-xs text-text-muted">{link.accountCode}</span>
                  {link.isPrimaryAccount && <Badge tone="brand">Primary company</Badge>}
                  {link.isPrimaryContact && <Badge tone="success">Primary contact of the account</Badge>}
                  {link.isDecisionMaker && <Badge tone="info">Decision maker</Badge>}
                  {link.status === "inactive" && <Badge tone="neutral">Left{link.endedAt ? ` ${formatDate(link.endedAt)}` : ""}</Badge>}
                </div>
                <span className="text-text-secondary">{[link.jobTitle, link.department, roleLabel(link.role)].filter(Boolean).join(" · ") || "No position recorded"}</span>
              </div>
              {canEdit && (
                <div className="flex flex-wrap gap-2">
                  {link.status === "active" && !link.isPrimaryAccount && (
                    <Button variant="outline" size="compact" onPress={() => action.mutate(() => setContactPrimaryAccount(contact.id, link.accountId))}>Make primary</Button>
                  )}
                  <Button variant="outline" size="compact" onPress={() => setEditing(link)}>{link.status === "active" ? "Edit role" : "Rejoin"}</Button>
                  {link.status === "active" && <Button variant="ghost" size="compact" onPress={() => setLeaving(link)}>Left company</Button>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && <CompanyLinkDialog contact={contact} link={editing === "new" ? null : editing} options={options} onClose={() => setEditing(null)} onDone={refresh} />}
      <AlertDialog
        isOpen={Boolean(leaving)}
        onOpenChange={(open) => !open && setLeaving(null)}
        title={`${contact.displayName} left ${leaving?.accountName ?? "the company"}?`}
        description="The link is kept as history with today's date, together with every activity, quotation and opportunity. The person stays in CRM and can be linked to another company."
        confirmLabel="Record that they left"
        isConfirming={action.isPending}
        onConfirm={() => leaving && action.mutate(() => updateContactAccount(contact.id, leaving.accountId, { status: "inactive" }))}
      />
    </section>
  );
}

function CompanyLinkDialog({ contact, link, options, onClose, onDone }: {
  contact: Contact; link: ContactAccountLink | null; options: ContactOptions; onClose: () => void; onDone: () => void;
}) {
  const [accountId, setAccountId] = useState<string | null>(link?.accountId ?? null);
  const [jobTitle, setJobTitle] = useState(link?.jobTitle ?? "");
  const [department, setDepartment] = useState(link?.department ?? "");
  const [role, setRole] = useState(link?.role ?? NO_ROLE);
  const [isDecisionMaker, setDecisionMaker] = useState(link?.isDecisionMaker ?? false);
  const [makePrimary, setMakePrimary] = useState(!contact.accountId);
  const [error, setError] = useState<string | null>(null);
  const fields = { jobTitle, department, role: role || null, isDecisionMaker };
  const mutation = useMutation({
    mutationFn: () => (link && link.status === "active"
      ? updateContactAccount(contact.id, link.accountId, fields)
      : linkContactAccount(contact.id, { accountId, ...fields, makePrimaryAccount: makePrimary })),
    onSuccess: () => { onDone(); onClose(); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={link ? `${link.accountName}` : "Link to a company"} description="The person's position at this company.">
      <div className="flex flex-col gap-4">
        <ErrorBanner message={error} />
        {!link && <AccountPicker label="Company" value={accountId} onChange={(id) => setAccountId(id)} />}
        <TextField label="Job title" value={jobTitle} onChange={setJobTitle} />
        <TextField label="Department" value={department} onChange={setDepartment} />
        <Select label="Role" selectedKey={role} onSelectionChange={(key) => setRole(String(key ?? NO_ROLE))}
          options={[{ value: NO_ROLE, label: "Not set" }, ...options.roles.map((entry) => ({ value: entry.code, label: entry.label }))]} />
        <Checkbox isSelected={isDecisionMaker} onChange={setDecisionMaker}>Decision maker</Checkbox>
        {(!link || link.status === "inactive") && <Checkbox isSelected={makePrimary} onChange={setMakePrimary}>Make this their primary company</Checkbox>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!link && !accountId}>{link ? "Save" : "Link company"}</Button>
        </div>
      </div>
    </Dialog>
  );
}
