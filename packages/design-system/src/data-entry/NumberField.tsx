import { forwardRef, type ReactNode } from "react";
import {
  NumberField as AriaNumberField,
  Input,
  Group,
  Button,
  type NumberFieldProps as AriaNumberFieldProps,
} from "react-aria-components";
import { ChevronUp, ChevronDown } from "lucide-react";
import { FieldChrome, inputChrome, type FieldChromeProps } from "./field-chrome.tsx";
import { cn } from "../utilities/cn.ts";

export interface NumberFieldProps
  extends Omit<AriaNumberFieldProps, "className">,
    Pick<FieldChromeProps, "label" | "description" | "errorMessage"> {
  className?: string;
  size?: "compact" | "standard";
  /** Rendered before the value, inside the field chrome (e.g. a currency symbol). */
  prefix?: ReactNode;
  /** Rendered after the value, inside the field chrome (e.g. a unit or "%"). */
  suffix?: ReactNode;
  /** Hide the increment/decrement stepper buttons — most ERP quantity/money
   * fields don't need them and they cost horizontal space in dense tables. */
  hideStepper?: boolean;
}

/**
 * Base numeric field. MoneyField/PercentageField/QuantityField below are
 * thin, opinionated presets over this — all still real NumberField
 * instances (proper numeric keyboard, locale-aware parsing/formatting via
 * Intl.NumberFormat under the hood).
 */
export const NumberField = forwardRef<HTMLInputElement, NumberFieldProps>(function NumberField(
  { className, label, description, errorMessage, isRequired, size, prefix, suffix, hideStepper, ...props },
  ref,
) {
  return (
    <AriaNumberField isRequired={isRequired} className={cn("group", className)} {...props}>
      <FieldChrome label={label} description={description} errorMessage={errorMessage} isRequired={isRequired}>
        <Group className={cn(inputChrome({ size }), "flex items-center gap-1 px-0")}>
          {prefix && <span className="pl-3 text-text-muted">{prefix}</span>}
          <Input
            ref={ref}
            className="h-full min-w-0 flex-1 bg-transparent px-3 text-right tabular-nums outline-none placeholder:text-text-subtle [appearance:textfield]"
          />
          {suffix && <span className="pr-2 text-text-muted">{suffix}</span>}
          {!hideStepper && (
            <div className="flex flex-col border-l border-border">
              <Button
                slot="increment"
                className="flex h-1/2 w-6 items-center justify-center text-text-muted hover:bg-surface-muted hover:text-text disabled:opacity-40"
              >
                <ChevronUp className="size-3" aria-hidden="true" />
              </Button>
              <Button
                slot="decrement"
                className="flex h-1/2 w-6 items-center justify-center border-t border-border text-text-muted hover:bg-surface-muted hover:text-text disabled:opacity-40"
              >
                <ChevronDown className="size-3" aria-hidden="true" />
              </Button>
            </div>
          )}
        </Group>
      </FieldChrome>
    </AriaNumberField>
  );
});
