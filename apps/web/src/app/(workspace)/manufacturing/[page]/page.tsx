import { notFound } from "next/navigation";

import { requireWorkspace } from "@/core/session";
import { redirectWithQuery } from "@/shared/routing/redirect-with-query";

// The earlier Manufacturing pages (production orders and their registers) now live in Manufacturing Orders and its inquiry and reports.
// These addresses keep working for bookmarks and links.
const MOVED: Record<string, { path: string; set?: Record<string, string> }> = {
  "production-orders": { path: "/manufacturing/orders" },
  "legacy-boms": { path: "/manufacturing/boms" },
  reservations: { path: "/manufacturing/orders" },
  consumption: { path: "/manufacturing/activity", set: { kind: "materials" } },
  "finished-output": { path: "/manufacturing/activity", set: { kind: "receipts" } },
  scrap: { path: "/manufacturing/activity", set: { kind: "quality" } },
  inspections: { path: "/manufacturing/activity", set: { kind: "quality" } },
  "material-planning": { path: "/manufacturing/material-demands" },
  "production-cost": { path: "/manufacturing/reports", set: { report: "variance" } },
  variance: { path: "/manufacturing/reports", set: { report: "variance" } },
  "standard-cost": { path: "/manufacturing/reports", set: { report: "variance" } },
  order: { path: "/manufacturing/orders" },
  bom: { path: "/manufacturing/boms" },
};

export default async function Page({ params, searchParams }: { params: Promise<{ page: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireWorkspace();
  const { page } = await params;
  const target = MOVED[page];
  if (!target) notFound();
  redirectWithQuery(target.path, await searchParams, target.set);
}
