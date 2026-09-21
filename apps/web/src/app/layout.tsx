import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import { getSessionContext } from "@/core/session";
import { resolveLocale } from "@/shared/providers/resolve-locale.ts";
import { LocaleProvider } from "@/shared/providers/locale-provider.tsx";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

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

export default async function RootLayout({ children }: { children: ReactNode }) {
  // The signed-in user's saved locale drives <html lang> and formatting; signed-out pages use the default.
  const session = await getSessionContext().catch(() => null);
  const locale = resolveLocale(session?.locale);
  return (
    <html lang={locale} className={inter.variable}>
      <body>
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
}
