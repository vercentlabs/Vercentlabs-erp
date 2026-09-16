import { PlatformFoundationPage } from "@/shell/module-foundation/PlatformFoundationPage";

export const metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <PlatformFoundationPage
      label="Settings"
      description="Organisation, companies, branches, users, roles, security, integrations, API keys, privacy, billing, feature configuration, audit and AI governance settings are being built out screen by screen. Their underlying APIs (roles/RBAC, API keys, OAuth, privacy, feature flags, AI governance) are already ported and live."
      quickLinks={[{ href: "/settings/profile", label: "Profile" }]}
    />
  );
}
