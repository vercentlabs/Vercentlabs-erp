"use client";

// The person's language for client components: useT() gives t(), which returns the English text itself when no translation exists.
// The same translation reaches the design system, so every field label, page title, button and menu item that is written as plain
// text is shown in the person's language without each screen asking for it.
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { TranslateProvider } from "@vercentlabs/design-system";

import { translator, type Translate } from "./translate";

const TextContext = createContext<{ locale: string; t: Translate }>({ locale: "en-IN", t: translator("en-IN") });

export function TextProvider({ locale, children }: { locale: string; children: ReactNode }) {
  const value = useMemo(() => ({ locale, t: translator(locale) }), [locale]);
  const plain = useMemo(() => (text: string) => value.t(text), [value]);
  return (
    <TextContext.Provider value={value}>
      <TranslateProvider translate={plain}>{children}</TranslateProvider>
    </TextContext.Provider>
  );
}

export const useT = () => useContext(TextContext).t;
export const useTextLocale = () => useContext(TextContext).locale;
