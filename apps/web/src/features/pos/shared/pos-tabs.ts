// The tabs of a POS workspace (shared by its server page, which picks the tab, and PosTabs, which draws the bar).
export type PosTab = { id: string; label: string; anyPermission?: string[] };

// The tab the URL asks for when it is one of the workspace's tabs, else the first.
export const tabOf = (tabs: ReadonlyArray<PosTab>, requested: string | string[] | undefined) =>
  (typeof requested === "string" && tabs.some((tab) => tab.id === requested) ? requested : tabs[0].id);

export const REPORT_TABS: ReadonlyArray<PosTab> = [
  { id: "sales", label: "Sales" }, { id: "payments", label: "Payments" }, { id: "returns-refunds", label: "Returns & Refunds" },
  { id: "cash-shifts", label: "Cash & Shifts" }, { id: "inventory", label: "Inventory" }, { id: "tax-documents", label: "GST & Documents" },
];
