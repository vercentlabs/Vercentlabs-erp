import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { siteConfig } from "@/lib/site-config";

import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.siteUrl),
  title: {
    default: "Vercent ERP | One connected system for business operations",
    template: "%s | Vercent ERP",
  },
  description:
    "Run finance, procurement, sales, CRM, stock, manufacturing, projects, assets, point of sale, quality, support, HR and payroll on one connected ERP.",
  applicationName: "Vercent ERP",
  alternates: {
    canonical: "/",
  },
  keywords: [
    "ERP software",
    "enterprise resource planning",
    "manufacturing ERP",
    "distribution ERP",
    "Indian business ERP",
    "Vercent ERP",
  ],
  openGraph: {
    type: "website",
    locale: siteConfig.locale,
    siteName: siteConfig.name,
    title: "Vercent ERP | Run every core operation in one system",
    description:
      "Twelve connected ERP modules with shared data, workflows, permissions and reporting.",
    url: siteConfig.siteUrl,
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "Vercent ERP connected business platform",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Vercent ERP | Run every core operation in one system",
    description:
      "Twelve connected ERP modules with shared data, workflows, permissions and reporting.",
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
