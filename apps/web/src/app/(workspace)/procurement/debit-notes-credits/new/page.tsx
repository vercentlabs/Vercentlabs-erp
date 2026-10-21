import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "New debit note or vendor credit" };

// Opened as an address of its own, this form opens over its list instead (see @modal/(.)procurement/debit-notes-credits/new).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("procurement/debit-notes-credits/new", "procurement/debit-notes-credits", await params, await searchParams);
}
