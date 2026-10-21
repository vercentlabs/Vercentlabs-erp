import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "New material issue" };

// Opened as an address of its own, this form opens over its list instead (see @modal/(.)manufacturing/material-issues/new).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("manufacturing/material-issues/new", "manufacturing/material-issues", await params, await searchParams);
}
