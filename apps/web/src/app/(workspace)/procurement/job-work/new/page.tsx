import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "Send material for job work" };

// Opened as an address of its own, this form opens over its list instead (see @modal/(.)procurement/job-work/new).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("procurement/job-work/new", "procurement/job-work", await params, await searchParams);
}
