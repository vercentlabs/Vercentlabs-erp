import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "Edit debit note" };

// Opened as an address of its own, this form opens over its record instead (see @modal/(.)procurement/debit-notes-credits/claims/[id]/edit).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("procurement/debit-notes-credits/claims/[id]/edit", "procurement/debit-notes-credits/claims/[id]", await params, await searchParams);
}
