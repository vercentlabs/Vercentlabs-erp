import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "New inspection checklist" };

// Opened as an address of its own, this form opens over its list instead (see @modal/(.)manufacturing/quality-checklists/new).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("manufacturing/quality-checklists/new", "manufacturing/quality-checklists", await params, await searchParams);
}
