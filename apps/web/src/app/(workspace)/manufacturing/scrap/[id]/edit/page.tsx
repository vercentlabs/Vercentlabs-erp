import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "Edit scrap note" };

// Opened as an address of its own, this form opens over its record instead (see @modal/(.)manufacturing/scrap/[id]/edit).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("manufacturing/scrap/[id]/edit", "manufacturing/scrap/[id]", await params, await searchParams);
}
