"use client";

import type { RegisterConfig } from "@/features/support/shared/Register";
import {
  badge,
  col,
  opts,
  strong,
  text,
} from "@/features/support/shared/helpers";

const PRIORITIES = opts("low", "normal", "high", "urgent", "critical");
// ---------------------------------------------------------------- F347: categories
const categories: RegisterConfig = {
  key: "categories",
  title: "Categories",
  description:
    "What a ticket is about. A category can set the default queue and priority a ticket routes to.",
  searchLabel: "Search categories",
  emptyTitle: "No categories yet",
  emptyDescription: "Add a category such as Billing or Technical Issue.",
  source: { kind: "view", view: "categories" },
  createLabel: "New category",
  createPermission: "support.manage",
  save: { action: "category-save", success: "Saved." },
  edit: { action: "category-save", permission: "support.manage" },
  fields: [
    {
      name: "code",
      label: "Code",
      kind: "text",
      required: true,
      createOnly: true,
    },
    { name: "name", label: "Name", kind: "text", required: true },
    { name: "description", label: "Description", kind: "textarea", wide: true },
    {
      name: "defaultPriority",
      label: "Default priority",
      kind: "select",
      defaultValue: "normal",
      options: PRIORITIES,
      rowKey: "default_priority",
    },
    { name: "active", label: "Active", kind: "bool", defaultValue: "true" },
  ],
  columns: () => [
    strong("code", "Code", (r) => String(r.code)),
    col("name", "Name", (r) => String(r.name)),
    col("parent", "Parent", (r) => String(r.parent_name ?? "—")),
    badge("priority", "Default priority", (r) => r.default_priority),
    col("queue", "Default queue", (r) => String(r.default_queue_name ?? "—")),
    badge("status", "Status", (r) => (r.active ? "active" : "inactive")),
  ],
  searchText: (r) => text(r, ["code", "name", "description"]),
};

export const CORE_REGISTERS: Record<string, RegisterConfig> = {
  categories,
};
