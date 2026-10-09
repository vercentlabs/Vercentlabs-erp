"use client";

// Inventory Configuration: one page, one section at a time — Inventory Policies (negative-stock control; the negative positions themselves
// are On-Hand Inventory → Negative), Valuation Setup (the default method and the large-adjustment threshold), Reason Codes (goods issue,
// quality hold and stock adjustment reasons) and Item Numbering. ?section= opens one; ?reason= picks the reason list. Units of measure are
// master data (Inventory › Master Data › Units of Measure). Earlier section ids keep working.
import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader, SavedViewBar, Tab, TabList, Tabs } from "@vercentlabs/design-system";

import { AdjustmentReasonsScreen } from "@/features/adjustments/screens/AdjustmentReasonsScreen";
import { GoodsIssueReasonsScreen } from "@/features/goods-issues/screens/GoodsIssueReasonsScreen";
import { ItemNumberingScreen } from "@/features/items/screens/ItemNumberingScreen";
import { NegativeStockPolicyPanel } from "@/features/negative-stock/components/NegativeStockPolicyPanel";
import { HoldReasons } from "@/features/quality-holds/screens/QualityHoldsScreen";

import { ValuationDefaults } from "../components/ValuationDefaults";

const SECTIONS = [
  { id: "policies", label: "Inventory Policies" }, { id: "valuation", label: "Valuation Setup" }, { id: "reasons", label: "Reason Codes" },
  { id: "item-numbering", label: "Item Numbering" },
] as const;
const REASONS = [{ id: "goods-issue", label: "Goods issue" }, { id: "hold", label: "Quality hold" }, { id: "adjustment", label: "Stock adjustment" }] as const;
type Section = (typeof SECTIONS)[number]["id"];
type Reason = (typeof REASONS)[number]["id"];
// Earlier addresses: ?section=negative-stock | goods-issue-reasons | hold-reasons.
const EARLIER: Record<string, { section: Section; reason?: Reason }> = {
  "negative-stock": { section: "policies" }, "goods-issue-reasons": { section: "reasons", reason: "goods-issue" }, "hold-reasons": { section: "reasons", reason: "hold" },
};


export function InventorySettingsScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const requested = params.get("section");
  const earlier = requested ? EARLIER[requested] : undefined;
  const section: Section = earlier?.section ?? (SECTIONS.some((entry) => entry.id === requested) ? (requested as Section) : "policies");
  const reason: Reason = earlier?.reason ?? (REASONS.find((entry) => entry.id === params.get("reason"))?.id ?? "goods-issue");
  useEffect(() => {
    // Units of measure moved to Master Data; an old link to the settings section opens that page.
    if (requested === "units") router.replace("/inventory/units-of-measure");
    else if (earlier) router.replace(`/inventory/settings?section=${earlier.section}${earlier.reason ? `&reason=${earlier.reason}` : ""}`);
  }, [requested, earlier, router]);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Inventory Configuration" description="Inventory policies, valuation setup, the reasons people choose from, and item numbering." />
      <Tabs selectedKey={section} onSelectionChange={(selected) => router.replace(`/inventory/settings?section=${String(selected)}`)}>
        <TabList aria-label="Configuration sections">{SECTIONS.map((entry) => <Tab key={entry.id} id={entry.id}>{entry.label}</Tab>)}</TabList>
      </Tabs>
      <div className="flex flex-col gap-4">
        {section === "policies" && <NegativeStockPolicyPanel />}
        {section === "valuation" && <ValuationDefaults />}
        {section === "reasons" && <>
          <SavedViewBar views={REASONS.map((entry) => ({ id: entry.id, label: entry.label }))} activeViewId={reason}
            onSelect={(id) => router.replace(`/inventory/settings?section=reasons&reason=${id}`)} />
          {reason === "goods-issue" && <GoodsIssueReasonsScreen />}
          {reason === "hold" && <HoldReasons />}
          {reason === "adjustment" && <AdjustmentReasonsScreen />}
        </>}
        {section === "item-numbering" && <ItemNumberingScreen />}
      </div>
    </div>
  );
}
