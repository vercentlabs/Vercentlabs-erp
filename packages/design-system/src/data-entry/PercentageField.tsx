import { forwardRef } from "react";
import { NumberField, type NumberFieldProps } from "./NumberField.tsx";

export type PercentageFieldProps = Omit<NumberFieldProps, "formatOptions" | "suffix">;

/** Percentage-formatted NumberField. `value` is the fraction (0.15 renders
 * "15%"), matching Intl.NumberFormat's percent style — do not pass 15
 * expecting "15%", that renders "1,500%". */
export const PercentageField = forwardRef<HTMLInputElement, PercentageFieldProps>(function PercentageField(
  { hideStepper = true, ...props },
  ref,
) {
  return (
    <NumberField
      ref={ref}
      hideStepper={hideStepper}
      formatOptions={{ style: "percent", maximumFractionDigits: 2 }}
      {...props}
    />
  );
});
