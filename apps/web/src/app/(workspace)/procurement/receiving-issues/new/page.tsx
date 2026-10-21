import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "Report receiving issue" };

// Opened as an address of its own, this form opens over its list instead (see @modal/(.)procurement/receiving-issues/new).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("procurement/receiving-issues/new", "procurement/goods-receipts?view=receiving-issues", await params, await searchParams);
}
