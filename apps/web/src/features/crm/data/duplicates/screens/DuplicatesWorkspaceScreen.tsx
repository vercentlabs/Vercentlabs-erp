"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Select, TextField, EnterpriseListPage, EmptyState, PermissionState } from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { listLeads } from "@/features/crm/leads/api/leads-api";
import type { Lead } from "@/features/crm/leads/types";
import { LeadDuplicatesWorkspacePanel } from "@/features/crm/leads/components/LeadDuplicatesWorkspacePanel";
import { listAccounts } from "@/features/crm/accounts/api/accounts-api";
import type { Account } from "@/features/crm/accounts/types";
import { AccountDuplicatesPanel } from "@/features/crm/accounts/components/AccountDuplicatesPanel";
import { listContacts } from "@/features/crm/contacts/api/contacts-api";
import type { Contact } from "@/features/crm/contacts/types";
import { ContactDuplicatesPanel } from "@/features/crm/contacts/components/ContactDuplicatesPanel";

type EntityType = "lead" | "account" | "contact";

// F008 Tranche G — a standalone duplicate-triage destination
// (/crm/data/duplicates), not tied to already being on a specific
// record's 360. Reuses the SAME governed duplicate-matching engine
// (findLeadDuplicates/findAccountDuplicates/findContactDuplicates) and
// the SAME resolution panels already built for each record type — no
// fuzzy matching or new merge logic invented here, per the mega-prompt's
// own instruction not to rebuild the matching engine in the browser.
// Candidate discovery is search-driven (pick a record, see ITS
// candidates) rather than a full-database pairwise scan: no backend
// function exists for the latter, and building one is a materially
// larger, separate capability, not a UI wiring gap.
export function DuplicatesWorkspaceScreen() {
  const workspace = useWorkspaceContext();
  const canView = workspace.permissions.includes(CRM_PERMISSIONS.leadsManage) || workspace.permissions.includes(CRM_PERMISSIONS.accountsManage);
  const [entityType, setEntityType] = useState<EntityType>("lead");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const leadsQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "duplicates-workspace", "lead", search),
    queryFn: () => listLeads({ search, limit: 20 }),
    enabled: entityType === "lead" && search.trim().length >= 2,
  });
  const accountsQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "duplicates-workspace", "account", search),
    queryFn: () => listAccounts({ search, limit: 20 }),
    enabled: entityType === "account" && search.trim().length >= 2,
  });
  const contactsQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "duplicates-workspace", "contact", search),
    queryFn: () => listContacts({ search, limit: 20 }),
    enabled: entityType === "contact" && search.trim().length >= 2,
  });

  if (!canView) return <PermissionState title="You don't have access to duplicate management" description="Ask an administrator to grant crm.leads.manage or crm.accounts.manage." />;

  const leadRows = leadsQuery.data?.rows ?? [];
  const accountRows = accountsQuery.data?.rows ?? [];
  const contactRows = contactsQuery.data?.rows ?? [];
  const isSearching = entityType === "lead" ? leadsQuery.isFetching : entityType === "account" ? accountsQuery.isFetching : contactsQuery.isFetching;

  const selectedLead: Lead | undefined = entityType === "lead" ? leadRows.find((row) => row.id === selectedId) : undefined;
  const selectedAccount: Account | undefined = entityType === "account" ? accountRows.find((row) => row.id === selectedId) : undefined;
  const selectedContact: Contact | undefined = entityType === "contact" ? contactRows.find((row) => row.id === selectedId) : undefined;

  function labelFor(type: EntityType, row: Lead | Account | Contact): string {
    if (type === "lead") {
      const lead = row as Lead;
      return `${lead.fullName || `${lead.firstName} ${lead.lastName || ""}`.trim()}${lead.companyName ? ` · ${lead.companyName}` : ""}`;
    }
    if (type === "account") return (row as Account).displayName;
    const contact = row as Contact;
    return `${contact.firstName} ${contact.lastName || ""}`.trim();
  }

  const rows: Array<Lead | Account | Contact> = entityType === "lead" ? leadRows : entityType === "account" ? accountRows : contactRows;

  return (
    <EnterpriseListPage
      header={{
        title: "Duplicate management",
        description: "Search for a Lead, Account or Contact to review possible duplicates and resolve them by dismissing or merging.",
      }}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <Select
            label="Record type"
            options={[
              { value: "lead", label: "Leads" },
              { value: "account", label: "Accounts" },
              { value: "contact", label: "Contacts" },
            ]}
            selectedKey={entityType}
            onSelectionChange={(key) => {
              setEntityType(key === "account" ? "account" : key === "contact" ? "contact" : "lead");
              setSelectedId(null);
            }}
          />
          <TextField
            label="Search"
            placeholder="Name, email, company…"
            value={search}
            onChange={(value) => {
              setSearch(value);
              setSelectedId(null);
            }}
          />
        </div>

        {search.trim().length < 2 && <EmptyState title="Search for a record" description="Type at least 2 characters to find a Lead, Account or Contact." />}
        {search.trim().length >= 2 && !selectedId && (
          <ul className="flex flex-col gap-1">
            {isSearching && <li className="text-sm text-text-secondary">Searching…</li>}
            {!isSearching && rows.length === 0 && <li className="text-sm text-text-muted">No matching records.</li>}
            {rows.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  className="w-full rounded-[var(--radius-control)] border border-border-strong px-3 py-2 text-left text-sm text-text hover:bg-canvas-strong"
                  onClick={() => setSelectedId(row.id)}
                >
                  {labelFor(entityType, row)}
                </button>
              </li>
            ))}
          </ul>
        )}

        {selectedLead && <LeadDuplicatesWorkspacePanel lead={selectedLead} canManage={workspace.permissions.includes(CRM_PERMISSIONS.leadsManage)} />}
        {selectedAccount && <AccountDuplicatesPanel account={selectedAccount} canManage={workspace.permissions.includes(CRM_PERMISSIONS.accountsManage)} />}
        {selectedContact && <ContactDuplicatesPanel contact={selectedContact} canManage={workspace.permissions.includes(CRM_PERMISSIONS.accountsManage)} />}
        {(selectedLead || selectedAccount || selectedContact) && (
          <button type="button" className="w-fit text-sm text-brand hover:underline" onClick={() => setSelectedId(null)}>
            Search another record
          </button>
        )}
      </div>
    </EnterpriseListPage>
  );
}
