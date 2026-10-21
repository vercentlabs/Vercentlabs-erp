import { createContext, useContext, type ReactNode } from "react";

/** The app's translation of screen text (CRM audit M7). Components pass the plain-string text they render — a field's label and
 * description, a page title, a button's words — through it; the app provides it from the person's language (apps/web shared/i18n),
 * and without a provider every text shows as written. Text that is not a plain string (a node someone built) is left alone. */
export type TranslateText = (text: string) => string;

const TranslateContext = createContext<TranslateText>((text) => text);

export function TranslateProvider({ translate, children }: { translate: TranslateText; children: ReactNode }) {
  return <TranslateContext.Provider value={translate}>{children}</TranslateContext.Provider>;
}

/** t(node): a plain string translated, anything else as it is. Children given as a list (an icon, then words) have their words
 * translated, keeping the spaces around them. */
export function useTranslateText() {
  const translate = useContext(TranslateContext);
  const one = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return text;
    const shown = translate(trimmed);
    return shown === trimmed ? text : text.replace(trimmed, () => shown);
  };
  return function t<T>(node: T): T {
    if (typeof node === "string") return one(node) as T;
    if (Array.isArray(node)) return node.map((child) => (typeof child === "string" ? one(child) : child)) as T;
    return node;
  };
}
