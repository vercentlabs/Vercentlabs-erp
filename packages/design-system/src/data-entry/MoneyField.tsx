import { forwardRef } from "react";
import { I18nProvider } from "react-aria-components";
import { NumberField, type NumberFieldProps } from "./NumberField.tsx";

export interface MoneyFieldProps extends Omit<NumberFieldProps, "formatOptions" | "prefix"> {
  /** ISO 4217 currency code, e.g. "USD". Required — money without a
   * currency is a defect, not a UX nicety. */
  currency: string;
  /** Overrides the ambient locale (from the nearest I18nProvider) for this
   * field only — e.g. a multi-branch form editing an amount in a branch's
   * own locale rather than the viewer's. */
  locale?: string;
}

/** Currency-formatted NumberField. Displays/parses using Intl.NumberFormat
 * currency formatting for the given currency — do not hand-roll "$"
 * prefixes, they silently break for non-USD/non-symbol-prefix currencies. */
export const MoneyField = forwardRef<HTMLInputElement, MoneyFieldProps>(function MoneyField(
  { currency, locale, hideStepper = true, ...props },
  ref,
) {
  const field = (
    <NumberField
      ref={ref}
      hideStepper={hideStepper}
      formatOptions={{ style: "currency", currency, currencyDisplay: "narrowSymbol" }}
      {...props}
    />
  );
  return locale ? <I18nProvider locale={locale}>{field}</I18nProvider> : field;
});
