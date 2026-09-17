import { forwardRef } from "react";
import { NumberField, type NumberFieldProps } from "./NumberField.tsx";

export interface QuantityFieldProps extends Omit<NumberFieldProps, "suffix"> {
  /** Unit of measure label, e.g. "kg", "pcs", "m". Shown as a suffix, not
   * baked into the value — UOM conversion is a backend/domain concern. */
  uom?: string;
}

/** Quantity NumberField with a visible UOM suffix and a stepper by default
 * (unlike Money/Percentage, incrementing by whole units is common for
 * quantities). */
export const QuantityField = forwardRef<HTMLInputElement, QuantityFieldProps>(function QuantityField(
  { uom, ...props },
  ref,
) {
  return <NumberField ref={ref} suffix={uom} {...props} />;
});
