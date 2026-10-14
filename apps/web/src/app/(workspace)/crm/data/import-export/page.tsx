import { requireWorkspace } from "@/core/session";
import { ImportDataScreen, type ImportKind } from "@/features/crm/shared/ImportDataScreen";

export const metadata = { title: "Import data" };

// CRM › Manage › Import data (?type=leads|companies|contacts). Export is on each list's "…" menu, for the view and filters shown there.
export default async function CrmImportDataPage({ searchParams }: { searchParams: Promise<{ type?: string | string[] }> }) {
  await requireWorkspace();
  const { type } = await searchParams;
  const kind = typeof type === "string" && ["leads", "companies", "contacts"].includes(type) ? (type as ImportKind) : null;
  return <ImportDataScreen initial={kind} />;
}
