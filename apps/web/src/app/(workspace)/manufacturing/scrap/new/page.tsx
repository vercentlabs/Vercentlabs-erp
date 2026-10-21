import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "Record scrap" };

// Opened as an address of its own, this form opens over its list instead (see @modal/(.)manufacturing/scrap/new).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("manufacturing/scrap/new", "manufacturing/scrap", await params, await searchParams);
}
