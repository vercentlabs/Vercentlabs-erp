import type { Metadata, Viewport } from "next";

import "../shared/design/tokens.css";
import "./globals.css";
import "./business-data-extension.css";
import "./crm-extension.css";
import "./billing-extension.css";
import "./operator-workbench.css";
import "./enterprise-modules.css";
import "./crm-overview-redesign.css";
import "./crm-lead-create.css";
import "./crm-lead-suite-enterprise.css";
import "./navigation-v2.css";
import "./workspace-redesign-v3.css";
import "./crm-hci-redesign.css";
import "./crm-accounts.css";
import "./crm-contacts.css";
import "./crm-lead-sources.css";
import "./crm-lead-lifecycle.css";
import "./crm-sales-stages.css";
import "./crm-calls.css";
import "./crm-meetings.css";

export const metadata: Metadata = {
  title: { default: "Vercentlabs ERP", template: "%s | Vercentlabs ERP" },
  description:
    "Secure Vercentlabs ERP workspace for organisations, companies and teams.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#17191f",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="app-body">{children}</body>
    </html>
  );
}
