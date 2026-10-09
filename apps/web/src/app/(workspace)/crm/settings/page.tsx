import { requireWorkspace } from "@/core/session";
import { redirectWithQuery } from "@/shared/routing/redirect-with-query";

// CRM configuration is Lead Setup, Opportunity Setup, Assignment Rules and Duplicate Detection; the earlier settings hub opens Lead Setup.
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireWorkspace();
  redirectWithQuery("/crm/settings/leads", await searchParams, { section: undefined });
}
