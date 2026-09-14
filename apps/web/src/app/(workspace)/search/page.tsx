import { PlatformFoundationPage } from "@/shell/module-foundation/PlatformFoundationPage";

export const metadata = { title: "Search" };

export default function SearchPage() {
  return (
    <PlatformFoundationPage
      label="Search"
      description="Tenant-scoped, permission-aware global search. The backend search adapter exists for CRM/Sales/Procurement/Accounting (see apps/web/src/app/api/search/route.ts) — the search results screen and command-menu integration are the next step."
    />
  );
}
