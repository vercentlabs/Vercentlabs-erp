import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "New project" };

// Opened as an address of its own, this form opens over its list instead (see @modal/(.)projects/new).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("projects/new", "projects", await params, await searchParams);
}
