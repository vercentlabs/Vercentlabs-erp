const DEFAULT_LOCALE = "en-IN";

// A stored locale is untrusted text until the runtime confirms it is a valid BCP 47 tag. The screens are in English only, so any
// other language saved earlier falls back to the default rather than turning date pickers and <html lang> to it.
export function resolveLocale(stored: string | null | undefined): string {
  if (!stored || !/^en(-|$)/i.test(stored)) return DEFAULT_LOCALE;
  try {
    const [canonical] = Intl.getCanonicalLocales(stored);
    return canonical &&
      Intl.NumberFormat.supportedLocalesOf(canonical).length > 0
      ? canonical
      : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}
