"use client";

// Insights → Reports: one page, three reports — Leads by status, Deals by stage and Companies. Each counts only the records the signed-in user
// can see and shares one layout: Group by and a few key filters, More filters, Export, and a table with a totals row.
import { useRouter } from "next/navigation";
import { PageHeader, Tab, TabList, TabPanel, Tabs } from "@vercentlabs/design-system";

import { AccountReportScreen } from "@/features/crm/accounts/screens/AccountReportScreen";
import { LeadsByStatusReport } from "@/features/crm/leads/screens/LeadDashboardScreen";
import { OpportunitiesByStageReport } from "@/features/crm/opportunities/screens/OpportunityDashboardScreen";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

// ?report=leads | opportunities | companies selects the report, and switching tabs keeps it in the URL.
export function CrmReportsScreen({ report }: { report: string | null }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const can = (permission: string) => workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(permission);
  const tabs = [
    { id: "leads", label: "Leads by status", show: can("crm.leads.view") || can("crm.view"), body: <LeadsByStatusReport /> },
    { id: "opportunities", label: "Deals by stage", show: can("crm.opportunities.view") || can("crm.view"), body: <OpportunitiesByStageReport /> },
    { id: "companies", label: "Companies", show: can("crm.accounts.view") || can("crm.view"), body: <AccountReportScreen /> },
  ].filter((tab) => tab.show);
  const selected = tabs.some((tab) => tab.id === report) ? report! : tabs[0]?.id;
  return (
    <div className="flex flex-1 flex-col gap-4">
      <PageHeader title="Reports" description="Leads by status, deals by stage and companies, over the records you can see." />
      <Tabs selectedKey={selected} onSelectionChange={(key) => router.replace(`/crm/reports?report=${String(key)}`, { scroll: false })}>
        <TabList aria-label="Reports">{tabs.map((tab) => <Tab key={tab.id} id={tab.id}>{tab.label}</Tab>)}</TabList>
        {tabs.map((tab) => <TabPanel key={tab.id} id={tab.id}><div className="pt-3">{tab.body}</div></TabPanel>)}
      </Tabs>
    </div>
  );
}
