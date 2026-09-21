"use client";

import type { RegisterConfig } from "@/features/quality/shared/Register";
import { badge, col, link, opts, quantity, text } from "@/features/quality/shared/helpers";

// F312-320: the inspection list -- creation and results/release live on the dedicated detail screen
// (InspectionDetailScreen) since a plan's points drive a dynamic per-point results form a generic
// register cannot express.
export function inspectionsRegister(scope: "all" | "open"): RegisterConfig {
  return {
    key: `inspections-${scope}`,
    title: scope === "open" ? "Open inspections" : "Inspections",
    description: scope === "open" ? "Draft or in-progress inspections awaiting results or completion." : "Every inspection.",
    searchLabel: "Search inspections",
    emptyTitle: "No inspections",
    emptyDescription: "Start an inspection against an active plan.",
    source: { kind: "view", view: "inspections", params: scope === "open" ? { status: "in_progress" } : {} },
    filters: scope === "all" ? [{ name: "status", label: "Status", options: opts("draft", "in_progress", "passed", "failed", "conditionally_accepted", "cancelled") }] : undefined,
    createLabel: "New inspection",
    newHref: "/quality/inspection-new",
    createPermission: "quality.inspect",
    columns: () => [
      link("number", "Number", (r) => String(r.inspection_number), (r) => `/quality/inspection/${String(r.id)}`),
      col("plan", "Plan", (r) => String(r.plan_name)),
      badge("type", "Type", (r) => r.inspection_type),
      col("lot", "Lot / sample", (r) => `${quantity(r.lot_quantity)} / ${quantity(r.sample_quantity)}`),
      badge("status", "Status", (r) => r.status),
    ],
    searchText: (r) => text(r, ["inspection_number", "plan_name", "inspection_type", "status"]),
  };
}

export const INSPECTION_REGISTERS: Record<string, RegisterConfig> = {
  inspections: inspectionsRegister("all"),
  "open-inspections": inspectionsRegister("open"),
};
