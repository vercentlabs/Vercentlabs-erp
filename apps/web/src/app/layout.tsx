import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import { LocaleProvider } from "@/shared/providers/locale-provider.tsx";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Vercentlabs ERP", template: "%s — Vercentlabs ERP" },
  description: "Vercentlabs ERP",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f5f6f8",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        {/* Fixed locale, not ambient browser/OS detection: React Aria's
            date/number formatting must render identically on the server
            and the client, or hydration fails — a real issue found via
            browser testing, not a style preference. Becomes tenant/user-
            locale-driven once localization is wired to a real settings
            source; until then, every viewer sees the same formatting. */}
        <LocaleProvider locale="en-US">{children}</LocaleProvider>
      </body>
    </html>
  );
}
