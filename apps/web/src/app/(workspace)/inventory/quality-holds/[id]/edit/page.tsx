import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "Edit quality hold" };

// Opened as an address of its own, this form opens over its record instead (see @modal/(.)inventory/quality-holds/[id]/edit).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("inventory/quality-holds/[id]/edit", "inventory/quality-holds/[id]", await params, await searchParams);
}
