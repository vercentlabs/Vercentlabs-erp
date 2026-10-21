import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "Edit material issue" };

// Opened as an address of its own, this form opens over its record instead (see @modal/(.)manufacturing/material-issues/[id]/edit).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("manufacturing/material-issues/[id]/edit", "manufacturing/material-issues/[id]", await params, await searchParams);
}
