"use client";

import type { ReactNode } from "react";
import { I18nProvider } from "react-aria-components";

// react-aria-components' I18nProvider uses createContext and isn't itself
// marked "use client" for direct import into a Server Component (layout.tsx)
// — this thin wrapper is the client boundary. Locale is fixed rather than
// browser-detected so server-rendered and client-rendered date/number
// formatting always match; wire to real tenant/user locale settings once
// that exists.
export function LocaleProvider({ locale, children }: { locale: string; children: ReactNode }) {
  return <I18nProvider locale={locale}>{children}</I18nProvider>;
}
