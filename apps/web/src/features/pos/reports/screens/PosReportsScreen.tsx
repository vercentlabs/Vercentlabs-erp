"use client";

// POS Reports: the operational reports, one category per tab (?tab=). Ledgers, tax returns, inventory valuation and bank reconciliation stay
// in their own modules — this page links to them rather than repeating them.
import Link from "next/link";
import { PageHeader } from "@vercentlabs/design-system";

import { CardReport } from "@/features/pos/reports/components/CardReport";
import { CashReport } from "@/features/pos/reports/components/CashReport";
import { DigitalReport } from "@/features/pos/reports/components/DigitalReport";
import { DiscountReport } from "@/features/pos/reports/components/DiscountReport";
import { GstReport } from "@/features/pos/reports/components/GstReport";
import { RefundsReport } from "@/features/pos/reports/components/RefundsReport";
import { ReprintReport } from "@/features/pos/reports/components/ReprintReport";
import { ReturnsReport } from "@/features/pos/reports/components/ReturnsReport";
import { ShiftClosingReport } from "@/features/pos/reports/components/ShiftClosingReport";
import { ShiftOpeningReport } from "@/features/pos/reports/components/ShiftOpeningReport";
import { SplitReport } from "@/features/pos/reports/components/SplitReport";
import { StockReport } from "@/features/pos/reports/components/StockReport";
import { TaxReport } from "@/features/pos/reports/components/TaxReport";
import { WalkInSummary } from "@/features/pos/reports/components/WalkInSummary";
import { CashDifferencesPanel } from "@/features/pos/cash-differences/components/CashDifferencesPanel";
import { REPORT_TABS } from "@/features/pos/shared/pos-tabs";
import { PosTabs } from "@/features/pos/shared/PosTabs";

const LINKS: Record<string, Array<[string, string]>> = {
  sales: [["Sales reports (all channels)", "/sales/reports"]],
  payments: [["Payment Reconciliation", "/pos/reconciliation"]],
  "cash-shifts": [["Shifts & Cash", "/pos/shifts?tab=history"], ["Day-End / Z Reports", "/pos/day-end"]],
  inventory: [["Stock balance", "/inventory/stock"], ["Inventory valuation", "/inventory/valuation"]],
  "tax-documents": [["Transactions › Documents", "/pos/transactions?tab=documents"], ["Accounting › Input Tax Credit", "/accounting/input-tax-credit"], ["Trial balance", "/accounting/trial-balance"]],
};

export function PosReportsScreen({ tab }: { tab: string }) {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Reports" description="Sales, payments, returns, cash and stock at your outlets. Ledgers, tax returns and valuation are in Accounting and Inventory." />
      <PosTabs label="Report categories" base="/pos/reports" tabs={REPORT_TABS} current={tab} />
      <div className="flex flex-col gap-4">
        {tab === "sales" && <><WalkInSummary /><DiscountReport /></>}
        {tab === "payments" && <><CashReport /><CardReport /><DigitalReport /><SplitReport /></>}
        {tab === "returns-refunds" && <><ReturnsReport /><RefundsReport /></>}
        {tab === "cash-shifts" && <><ShiftOpeningReport /><ShiftClosingReport /><CashDifferencesPanel /></>}
        {tab === "inventory" && <StockReport />}
        {tab === "tax-documents" && <><TaxReport /><GstReport /><ReprintReport /></>}
      </div>
      {LINKS[tab] && (
        <p className="text-xs text-text-muted">Also: {LINKS[tab].map(([label, href], index) => (
          <span key={href}>{index ? " · " : ""}<Link className="text-brand underline" href={href}>{label}</Link></span>))}</p>
      )}
    </div>
  );
}
