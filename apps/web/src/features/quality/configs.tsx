"use client";

import { act } from "@/features/quality/shared/client";
import type { RegisterConfig } from "@/features/quality/shared/Register";
import {
  badge,
  col,
  opts,
  quantity,
  strong,
  text,
} from "@/features/quality/shared/helpers";

const PLAN_TYPES = opts(
  "incoming",
  "in_process",
  "final",
  "stock_audit",
  "supplier",
  "customer_return",
);

// ---------------------------------------------------------------- F308-311/F318: quality plans (list only -- creation is a dedicated builder screen, see PlanBuilderScreen)
const plans: RegisterConfig = {
  key: "plans",
  title: "Quality plans",
  description:
    "What to check, and against what tolerance, for incoming/in-process/final inspection. A plan is approved by someone other than its author before it governs real inspections.",
  searchLabel: "Search plans",
  emptyTitle: "No quality plans yet",
  emptyDescription: "Build a plan to start inspecting against it.",
  source: { kind: "view", view: "plans" },
  filters: [
    { name: "planType", label: "Type", options: PLAN_TYPES },
    {
      name: "status",
      label: "Status",
      options: opts("draft", "active", "inactive", "obsolete"),
    },
  ],
  createLabel: "New plan",
  newHref: "/quality/plan-builder",
  createPermission: "quality.plan.manage",
  columns: () => [
    strong("code", "Code", (r) => `${r.code} v${r.version}`),
    col("name", "Name", (r) => String(r.name)),
    badge("type", "Type", (r) => r.plan_type),
    col("points", "Points", (r) => quantity(r.point_count)),
    col(
      "sampling",
      "Sampling",
      (r) =>
        `${r.sampling_method}${r.sampling_method === "percentage" ? ` (${r.sampling_value}%)` : ""}`,
    ),
    badge("status", "Status", (r) => r.status),
  ],
  searchText: (r) => text(r, ["code", "name", "plan_type", "status"]),
  rowActions: [
    {
      label: "Approve",
      permission: "quality.plan.manage",
      show: (r) => r.status === "draft",
      run: (r) => act("plan-approve", { id: r.id }),
      success: "Approved. It now governs real inspections.",
    },
    {
      label: "Revise (new version)",
      permission: "quality.plan.manage",
      show: (r) => ["active", "obsolete"].includes(String(r.status)),
      run: (r) => act("plan-revise", { id: r.id }),
      success: "A new draft version was created.",
    },
    {
      label: "Retire",
      permission: "quality.plan.manage",
      show: (r) => ["active", "inactive"].includes(String(r.status)),
      note: { label: "Reason", required: true },
      run: (r, note) => act("plan-retire", { id: r.id, reason: note }),
      success: "Retired.",
    },
  ],
};

export const CORE_REGISTERS: Record<string, RegisterConfig> = {
  plans,
};
