import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "Edit production entry" };

// Opened as an address of its own, this form opens over its record instead (see @modal/(.)manufacturing/production-entries/[id]/edit).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("manufacturing/production-entries/[id]/edit", "manufacturing/production-entries/[id]", await params, await searchParams);
}
