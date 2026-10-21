"use client";

import type { ReactNode } from "react";
import { I18nProvider } from "react-aria-components";

import { TextProvider } from "@/shared/i18n/I18nText";

// react-aria-components' I18nProvider uses createContext and isn't itself
// marked "use client" for direct import into a Server Component (layout.tsx)
// — this thin wrapper is the client boundary. Locale is fixed rather than
// browser-detected so server-rendered and client-rendered date/number
// formatting always match; wire to real tenant/user locale settings once
// that exists.
export function LocaleProvider({
  locale,
  children,
}: {
  locale: string;
  children: ReactNode;
}) {
  // The person's language also picks the screens' text (shared/i18n, CRM audit M7).
  return <I18nProvider locale={locale}><TextProvider locale={locale}>{children}</TextProvider></I18nProvider>;
}
