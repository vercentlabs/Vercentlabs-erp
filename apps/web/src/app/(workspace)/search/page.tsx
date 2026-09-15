import { PlatformFoundationPage } from "@/shell/module-foundation/PlatformFoundationPage";

export const metadata = { title: "Search" };

export default function SearchPage() {
  return (
    <PlatformFoundationPage
      label="Search"
      description="Tenant-scoped, permission-aware global search across modules. Verified during the CRM rebuild (Prompt 3, 2026-09-15) that no backend search adapter or route exists yet for any module — this needs its own cross-module prompt, not a CRM-scoped one."
    />
  );
}
