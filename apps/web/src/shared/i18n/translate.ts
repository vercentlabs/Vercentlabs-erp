// The translation layer (CRM audit M7): screens are written in English, and each English text is its own key — t("Leads") — so a
// string is translated by adding it to a language's dictionary, and anything not yet translated simply shows in English. The
// language is the signed-in person's own (Profile › Language), the same locale that drives <html lang> and formatting.
import { HINDI } from "./messages/hi";
import { HINDI_CRM } from "./messages/hi-crm";
import { HINDI_SALES } from "./messages/hi-sales";

export type Translate = (text: string, values?: Record<string, string | number>) => string;

const DICTIONARIES: Record<string, Readonly<Record<string, string>>> = { hi: { ...HINDI, ...HINDI_CRM, ...HINDI_SALES } };

// "hi-IN" → the Hindi dictionary; English (or any language without one) → none.
export function dictionaryFor(locale: string | null | undefined): Readonly<Record<string, string>> | null {
  const language = String(locale ?? "").toLowerCase().split("-")[0] ?? "";
  return DICTIONARIES[language] ?? null;
}

// {name} in the text (and in its translation) is replaced by values.name.
const fill = (text: string, values?: Record<string, string | number>) =>
  values ? text.replace(/\{(\w+)\}/g, (whole, key: string) => (key in values ? String(values[key]) : whole)) : text;

export function translator(locale: string | null | undefined): Translate {
  const dictionary = dictionaryFor(locale);
  return (text, values) => fill(dictionary?.[text] ?? text, values);
}
