"use client";

// Import data: one page for bringing leads, companies, contacts and deals in from a file. It asks what is being imported, then runs that record's
// own importer (template, column mapping, options and the result). The old addresses (/crm/leads/import, /crm/accounts/import,
// /crm/contacts/import, /crm/opportunities/import) open it with the type already chosen. Export stays on each list's "…" menu, for what the
// list shows; a file too large for either runs in the background and is listed here.
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { PageHeader, PermissionState, Tab, TabList, Tabs } from "@vercentlabs/design-system";

import { AccountImportScreen } from "@/features/crm/accounts/screens/AccountImportScreen";
import { ContactImportScreen } from "@/features/crm/contacts/screens/ContactImportScreen";
import { LeadImportScreen } from "@/features/crm/leads/screens/LeadImportScreen";
import { OpportunityImportScreen } from "@/features/crm/opportunities/screens/OpportunityImportScreen";
import { BackgroundRunsPanel } from "@/features/crm/shared/ui/BackgroundRunsPanel";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

export type ImportKind = "leads" | "companies" | "contacts" | "deals";
const KINDS: Array<{ id: ImportKind; label: string; permission: string }> = [
  { id: "leads", label: "Leads", permission: "crm.import" },
  { id: "companies", label: "Companies", permission: "crm.accounts.import" },
  { id: "contacts", label: "Contacts", permission: "crm.contacts.import" },
  { id: "deals", label: "Deals", permission: "crm.opportunities.import" },
];

export function ImportDataScreen({ initial }: { initial?: ImportKind | null }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const pathname = usePathname();
  const owner = workspace.roleSlugs.includes("organization_owner");
  const kinds = KINDS.filter((kind) => owner || workspace.permissions.includes(kind.permission));
  const [kind, setKind] = useState<ImportKind | null>(kinds.some((entry) => entry.id === initial) ? initial! : kinds[0]?.id ?? null);
  if (!kind) return (
    <div className="flex flex-col gap-6">
      <PermissionState title="You can't import CRM data" description="Ask an administrator for an import permission." />
      <BackgroundRunsPanel />
    </div>
  );
  const choose = (next: ImportKind) => {
    setKind(next);
    if (pathname === "/crm/data/import-export") router.replace(`${pathname}?type=${next}`, { scroll: false });
  };
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Import data" description="Bring leads, companies, contacts or deals in from a CSV or Excel (.xlsx) file. Download the template for the kind you import. Large files, and exports too large to download at once, run in the background." />
      <Tabs selectedKey={kind} onSelectionChange={(key) => choose(String(key) as ImportKind)}>
        <TabList aria-label="What are you importing?">{kinds.map((entry) => <Tab key={entry.id} id={entry.id}>{entry.label}</Tab>)}</TabList>
      </Tabs>
      {kind === "leads" && <LeadImportScreen key="leads" embedded />}
      {kind === "companies" && <AccountImportScreen key="companies" embedded />}
      {kind === "contacts" && <ContactImportScreen key="contacts" embedded />}
      {kind === "deals" && <OpportunityImportScreen key="deals" />}
    </div>
  );
}
