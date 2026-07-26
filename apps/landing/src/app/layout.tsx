import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { siteConfig } from "@/lib/site-config";

import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.siteUrl),
  title: {
    default: "Vercentlabs ERP | One connected system for business operations",
    template: "%s | Vercentlabs ERP",
  },
  description:
    "Explore the Vercentlabs ERP platform foundation and CRM early access, with additional operational modules planned for phased delivery.",
  applicationName: "Vercentlabs ERP",
  alternates: {
    canonical: "/",
  },
  keywords: [
    "ERP software",
    "enterprise resource planning",
    "manufacturing ERP",
    "distribution ERP",
    "Indian business ERP",
    "Vercentlabs ERP",
  ],
  openGraph: {
    type: "website",
    locale: siteConfig.locale,
    siteName: siteConfig.name,
    title: "Vercentlabs ERP | Platform foundation and CRM early access",
    description:
      "A governed ERP platform foundation and CRM early access, with a clearly labelled roadmap for additional modules.",
    url: siteConfig.siteUrl,
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "Vercentlabs ERP connected business platform",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Vercentlabs ERP | Platform foundation and CRM early access",
    description:
      "A governed ERP platform foundation and CRM early access, with a clearly labelled roadmap for additional modules.",
    images: ["/opengraph-image"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: siteConfig.themeColor,
};

type RootLayoutProps = Readonly<{
  children: ReactNode;
}>;

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en" data-theme="light">
      <body className="font-body antialiased">
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
