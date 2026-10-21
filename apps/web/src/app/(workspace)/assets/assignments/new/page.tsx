import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "New assignment" };

// Opened as an address of its own, this form opens over its list instead (see @modal/(.)assets/assignments/new).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("assets/assignments/new", "assets/assignments", await params, await searchParams);
}
