"use client";

import { act } from "@/features/quality/shared/client";
import type { RegisterConfig } from "@/features/quality/shared/Register";
import {
  badge,
  col,
  opts,
  strong,
  text,
} from "@/features/quality/shared/helpers";

const DISPOSITIONS = opts(
  "accept",
  "accept_with_deviation",
  "rework",
  "repair",
  "return_to_supplier",
  "scrap",
  "use_as_is",
);

// ---------------------------------------------------------------- F321,325-329: non-conformances
const nonconformances: RegisterConfig = {
  key: "nonconformances",
  title: "Non-conformances",
  description:
    "Open -> under review -> contained -> a disposition is set (use-as-is needs a second person's approval) -> closed. A major or critical one needs a verified-effective CAPA before it can close.",
  searchLabel: "Search non-conformances",
  emptyTitle: "No non-conformances",
  emptyDescription:
    "One appears here once raised, manually or automatically from a failed inspection.",
  source: { kind: "view", view: "nonconformances" },
  filters: [
    {
      name: "status",
      label: "Status",
      options: opts(
        "open",
        "under_review",
        "contained",
        "corrective_action",
        "verified",
        "closed",
        "cancelled",
      ),
    },
    {
      name: "severity",
      label: "Severity",
      options: opts("minor", "major", "critical"),
    },
  ],
  createLabel: "Report a non-conformance",
  createPermission: "quality.nonconformance.manage",
  save: { action: "nc-create", success: "Reported." },
  fields: [
    {
      name: "severity",
      label: "Severity",
      kind: "select",
      defaultValue: "minor",
      options: opts("minor", "major", "critical"),
      required: true,
    },
    { name: "category", label: "Category", kind: "text", required: true },
    {
      name: "description",
      label: "Description",
      kind: "textarea",
      required: true,
      wide: true,
    },
    { name: "itemId", label: "Item", kind: "select", options: "items" },
    {
      name: "supplierId",
      label: "Supplier",
      kind: "select",
      options: "suppliers",
    },
    {
      name: "detectedQuantity",
      label: "Detected quantity",
      kind: "number",
      step: 1,
    },
    {
      name: "affectedQuantity",
      label: "Affected quantity",
      kind: "number",
      step: 1,
    },
    {
      name: "estimatedCost",
      label: "Estimated cost",
      kind: "number",
      step: 100,
    },
    { name: "dueDate", label: "Due date", kind: "date" },
  ],
  columns: () => [
    strong("number", "Number", (r) => String(r.nonconformance_number)),
    badge("severity", "Severity", (r) => r.severity),
    col("category", "Category", (r) => String(r.category)),
    col("description", "Description", (r) => String(r.description)),
    col("disposition", "Disposition", (r) =>
      r.disposition ? String(r.disposition).replace(/_/g, " ") : "—",
    ),
    badge("status", "Status", (r) => r.status),
  ],
  searchText: (r) =>
    text(r, [
      "nonconformance_number",
      "severity",
      "category",
      "description",
      "status",
    ]),
  rowActions: [
    {
      label: "Start review",
      permission: "quality.nonconformance.manage",
      show: (r) => r.status === "open",
      run: (r) => act("nc-transition", { id: r.id, action: "review" }),
      success: "Under review.",
    },
    {
      label: "Record containment",
      permission: "quality.nonconformance.manage",
      show: (r) => r.status === "under_review",
      fields: [
        {
          name: "containmentAction",
          label: "Containment action",
          kind: "textarea",
          required: true,
          wide: true,
        },
      ],
      run: (r, _n, v) =>
        act("nc-transition", {
          id: r.id,
          action: "contain",
          containmentAction: v.containmentAction,
        }),
      success: "Contained.",
    },
    {
      label: "Set disposition",
      permission: "quality.nonconformance.manage",
      show: (r) => !["closed", "cancelled"].includes(String(r.status)),
      fields: [
        {
          name: "disposition",
          label: "Disposition",
          kind: "select",
          options: DISPOSITIONS,
          required: true,
        },
        {
          name: "dispositionQuantity",
          label: "Quantity",
          kind: "number",
          step: 1,
        },
        {
          name: "reason",
          label: "Reason (required for use-as-is)",
          kind: "textarea",
          wide: true,
        },
      ],
      run: (r, _n, v) =>
        act("nc-disposition", {
          id: r.id,
          disposition: v.disposition,
          dispositionQuantity: v.dispositionQuantity,
          reason: v.reason,
        }),
      success: "Disposition set.",
    },
    {
      label: "Approve use-as-is",
      permission: "quality.manage",
      show: (r) => r.disposition === "use_as_is" && !r.use_as_is_approved_at,
      run: (r) => act("nc-use-as-is-decide", { id: r.id, approve: true }),
      success: "Approved.",
    },
    {
      label: "Reject use-as-is",
      permission: "quality.manage",
      show: (r) => r.disposition === "use_as_is" && !r.use_as_is_approved_at,
      note: { label: "Reason", required: true },
      run: (r, note) =>
        act("nc-use-as-is-decide", { id: r.id, approve: false, reason: note }),
      success: "Rejected; set a different disposition.",
    },
    {
      label: "Close",
      permission: "quality.nonconformance.manage",
      show: (r) =>
        !["closed", "cancelled"].includes(String(r.status)) &&
        Boolean(r.disposition),
      run: (r) => act("nc-close", { id: r.id }),
      success: "Closed.",
    },
    {
      label: "Cancel",
      permission: "quality.nonconformance.manage",
      show: (r) => r.status === "open",
      note: { label: "Reason", required: true },
      run: (r, note) => act("nc-cancel", { id: r.id, reason: note }),
      success: "Cancelled.",
    },
  ],
};

export const NC_REGISTERS: Record<string, RegisterConfig> = {
  nonconformances,
};
