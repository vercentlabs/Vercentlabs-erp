export const DEFAULT_LOCALE = "en-IN";

// A stored locale is untrusted text until the runtime confirms it is a valid BCP 47 tag.
export function resolveLocale(stored: string | null | undefined): string {
  if (!stored) return DEFAULT_LOCALE;
  try {
    const [canonical] = Intl.getCanonicalLocales(stored);
    return canonical && Intl.NumberFormat.supportedLocalesOf(canonical).length > 0 ? canonical : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}
