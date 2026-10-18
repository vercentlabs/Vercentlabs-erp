"use client";

// Insights → Reports: Leads by status, Deals by stage and Companies, and (CRM plan 3.7) the Forecast by close month, Trends, a Pivot,
// each salesperson's Activities and their monthly Targets. Each counts only the records the signed-in user can see.
import { useRouter } from "next/navigation";
import { PageHeader, Tab, TabList, TabPanel, Tabs } from "@vercentlabs/design-system";

import { AccountReportScreen } from "@/features/crm/accounts/screens/AccountReportScreen";
import { LeadsByStatusReport } from "@/features/crm/leads/screens/LeadDashboardScreen";
import { OpportunitiesByStageReport } from "@/features/crm/opportunities/screens/OpportunityDashboardScreen";
import { ActivityReport, ForecastReport, PivotReport, TargetsReport, TrendsReport } from "@/features/crm/reports/components/InsightReports";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

// ?report=leads | opportunities | companies | forecast | trends | pivot | activities | targets selects the report, and switching tabs
// keeps it in the URL.
export function CrmReportsScreen({ report }: { report: string | null }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const can = (permission: string) => workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(permission);
  const leads = can("crm.leads.view") || can("crm.view");
  const deals = can("crm.opportunities.view") || can("crm.view");
  const tabs = [
    { id: "leads", label: "Leads by status", show: leads, body: <LeadsByStatusReport /> },
    { id: "opportunities", label: "Deals by stage", show: deals, body: <OpportunitiesByStageReport /> },
    { id: "companies", label: "Companies", show: can("crm.accounts.view") || can("crm.view"), body: <AccountReportScreen /> },
    { id: "forecast", label: "Forecast", show: deals, body: <ForecastReport /> },
    { id: "trends", label: "Trends", show: leads || deals, body: <TrendsReport /> },
    { id: "pivot", label: "Pivot", show: leads || deals, body: <PivotReport /> },
    { id: "activities", label: "Activities", show: leads || deals, body: <ActivityReport /> },
    { id: "targets", label: "Targets", show: leads || deals, body: <TargetsReport /> },
  ].filter((tab) => tab.show);
  const selected = tabs.some((tab) => tab.id === report) ? report! : tabs[0]?.id;
  return (
    <div className="flex flex-1 flex-col gap-4">
      <PageHeader title="Reports" description="Leads, deals and companies; the forecast by month; trends; a pivot; and each salesperson's activity and targets — over the records you can see." />
      <Tabs selectedKey={selected} onSelectionChange={(key) => router.replace(`/crm/reports?report=${String(key)}`, { scroll: false })}>
        <TabList aria-label="Reports">{tabs.map((tab) => <Tab key={tab.id} id={tab.id}>{tab.label}</Tab>)}</TabList>
        {tabs.map((tab) => <TabPanel key={tab.id} id={tab.id}><div className="pt-3">{tab.body}</div></TabPanel>)}
      </Tabs>
    </div>
  );
}
