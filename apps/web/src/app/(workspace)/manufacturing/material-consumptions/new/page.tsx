import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "Record material consumption" };

// Opened as an address of its own, this form opens over its list instead (see @modal/(.)manufacturing/material-consumptions/new).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("manufacturing/material-consumptions/new", "manufacturing/material-consumptions", await params, await searchParams);
}
