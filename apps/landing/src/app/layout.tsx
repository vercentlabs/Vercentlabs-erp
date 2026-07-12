import type { Metadata, Viewport } from "next";
import { Manrope, Sora } from "next/font/google";
import type { ReactNode } from "react";

import { siteConfig } from "@/lib/site-config";

import "./globals.css";

const sora = Sora({
  subsets: ["latin"],
  variable: "--font-sora",
  display: "swap",
  weight: ["400", "500", "600", "700", "800"],
});

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  display: "swap",
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.siteUrl),

  title: {
    default: siteConfig.title,
    template: `%s | ${siteConfig.name}`,
  },

  description: siteConfig.description,
  applicationName: siteConfig.productName,

  openGraph: {
    type: "website",
    locale: siteConfig.locale,
    siteName: siteConfig.name,
    title: siteConfig.title,
    description: siteConfig.description,
    url: siteConfig.siteUrl,
  },

  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  themeColor: siteConfig.themeColor,
};

type RootLayoutProps = Readonly<{
  children: ReactNode;
}>;

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body className={`${sora.variable} ${manrope.variable}`}>
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>

        {children}
      </body>
    </html>
  );
}
