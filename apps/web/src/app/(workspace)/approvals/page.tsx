import { PlatformFoundationPage } from "@/shell/module-foundation/PlatformFoundationPage";

export const metadata = { title: "Approvals" };

export default function ApprovalsPage() {
  return (
    <PlatformFoundationPage
      label="Approvals"
      requiredPermission="approvals.manage"
      description="A global approval inbox is planned once the underlying approvals engine's live status is confirmed (see docs/frontend-rebuild/PLATFORM_PORT_REGISTER.csv)."
    />
  );
}
