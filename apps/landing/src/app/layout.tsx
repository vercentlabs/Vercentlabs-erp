import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import OrganizationJsonLd from "@/components/seo/organization-json-ld";
import { createPageMetadata } from "@/lib/metadata";
import { siteConfig } from "@/lib/site-config";

import "./globals.css";

const rootMetadata = createPageMetadata({
  title: siteConfig.title,
  description: siteConfig.description,
  path: "/",
});

export const metadata: Metadata = {
  ...rootMetadata,
  metadataBase: new URL(siteConfig.siteUrl),
  title: {
    default: siteConfig.title,
    template: "%s | " + siteConfig.name,
  },
  applicationName: siteConfig.productName,
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/brand/logo.png",
    apple: "/brand/logo.png",
  },
  category: "business software",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: siteConfig.themeColor,
  colorScheme: "light",
};

type RootLayoutProps = Readonly<{
  children: ReactNode;
}>;

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en-IN" data-theme="light">
      <body className="font-body">
        <OrganizationJsonLd />
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
