import { useFieldContext } from "./form-context.ts";
import { TextField as TextFieldBase, type TextFieldProps } from "../data-entry/TextField.tsx";
import { TextArea as TextAreaBase, type TextAreaProps } from "../data-entry/TextArea.tsx";
import { NumberField as NumberFieldBase, type NumberFieldProps } from "../data-entry/NumberField.tsx";
import { MoneyField as MoneyFieldBase, type MoneyFieldProps } from "../data-entry/MoneyField.tsx";
import { PercentageField as PercentageFieldBase, type PercentageFieldProps } from "../data-entry/PercentageField.tsx";
import { QuantityField as QuantityFieldBase, type QuantityFieldProps } from "../data-entry/QuantityField.tsx";
import { Checkbox as CheckboxBase, type CheckboxProps } from "../data-entry/Checkbox.tsx";
import { Switch as SwitchBase, type SwitchProps } from "../data-entry/Switch.tsx";
import { Select as SelectBase, type SelectProps } from "../data-entry/Select.tsx";
import { ComboBox as ComboBoxBase, type ComboBoxProps } from "../data-entry/ComboBox.tsx";
import { RadioGroup as RadioGroupBase, type RadioGroupProps } from "../data-entry/RadioGroup.tsx";

/** Extracts a readable message list from TanStack Form's field errors,
 * which may be plain strings or Standard-Schema issue objects (Zod). */
function errorMessages(errors: unknown[]): string[] {
  return errors
    .map((e) => (typeof e === "string" ? e : (e as { message?: string })?.message))
    .filter((m): m is string => Boolean(m));
}

/** Only surface errors once the field has been touched or a submit was
 * attempted — showing "required" before the user has typed anything is
 * exactly the noisy-validation pattern the HCI standard forbids. */
function useFieldErrorMessage(field: { state: { meta: { isTouched: boolean; errors: unknown[] } }; form: { state: { submissionAttempts: number } } }): string | undefined {
  const shouldShow = field.state.meta.isTouched || field.form.state.submissionAttempts > 0;
  if (!shouldShow) return undefined;
  const messages = errorMessages(field.state.meta.errors);
  return messages.length > 0 ? messages.join(", ") : undefined;
}

export function TextFieldElement(props: Omit<TextFieldProps, "value" | "onChange" | "onBlur" | "name" | "errorMessage">) {
  const field = useFieldContext<string>();
  const errorMessage = useFieldErrorMessage(field);
  return (
    <TextFieldBase
      name={field.name}
      value={field.state.value ?? ""}
      onChange={(value) => field.handleChange(value)}
      onBlur={field.handleBlur}
      errorMessage={errorMessage}
      isInvalid={Boolean(errorMessage)}
      {...props}
    />
  );
}

export function TextAreaElement(props: Omit<TextAreaProps, "value" | "onChange" | "onBlur" | "name" | "errorMessage">) {
  const field = useFieldContext<string>();
  const errorMessage = useFieldErrorMessage(field);
  return (
    <TextAreaBase
      name={field.name}
      value={field.state.value ?? ""}
      onChange={(value) => field.handleChange(value)}
      onBlur={field.handleBlur}
      errorMessage={errorMessage}
      isInvalid={Boolean(errorMessage)}
      {...props}
    />
  );
}

export function NumberFieldElement(props: Omit<NumberFieldProps, "value" | "onChange" | "onBlur" | "name" | "errorMessage">) {
  const field = useFieldContext<number>();
  const errorMessage = useFieldErrorMessage(field);
  return (
    <NumberFieldBase
      name={field.name}
      value={field.state.value}
      onChange={(value) => field.handleChange(value)}
      onBlur={field.handleBlur}
      errorMessage={errorMessage}
      isInvalid={Boolean(errorMessage)}
      {...props}
    />
  );
}

export function MoneyFieldElement(props: Omit<MoneyFieldProps, "value" | "onChange" | "onBlur" | "name" | "errorMessage">) {
  const field = useFieldContext<number>();
  const errorMessage = useFieldErrorMessage(field);
  return (
    <MoneyFieldBase
      name={field.name}
      value={field.state.value}
      onChange={(value) => field.handleChange(value)}
      onBlur={field.handleBlur}
      errorMessage={errorMessage}
      isInvalid={Boolean(errorMessage)}
      {...props}
    />
  );
}

export function PercentageFieldElement(props: Omit<PercentageFieldProps, "value" | "onChange" | "onBlur" | "name" | "errorMessage">) {
  const field = useFieldContext<number>();
  const errorMessage = useFieldErrorMessage(field);
  return (
    <PercentageFieldBase
      name={field.name}
      value={field.state.value}
      onChange={(value) => field.handleChange(value)}
      onBlur={field.handleBlur}
      errorMessage={errorMessage}
      isInvalid={Boolean(errorMessage)}
      {...props}
    />
  );
}

export function QuantityFieldElement(props: Omit<QuantityFieldProps, "value" | "onChange" | "onBlur" | "name" | "errorMessage">) {
  const field = useFieldContext<number>();
  const errorMessage = useFieldErrorMessage(field);
  return (
    <QuantityFieldBase
      name={field.name}
      value={field.state.value}
      onChange={(value) => field.handleChange(value)}
      onBlur={field.handleBlur}
      errorMessage={errorMessage}
      isInvalid={Boolean(errorMessage)}
      {...props}
    />
  );
}

export function CheckboxElement(props: Omit<CheckboxProps, "isSelected" | "onChange" | "onBlur" | "name">) {
  const field = useFieldContext<boolean>();
  return (
    <CheckboxBase
      name={field.name}
      isSelected={field.state.value ?? false}
      onChange={(value) => field.handleChange(value)}
      onBlur={field.handleBlur}
      {...props}
    />
  );
}

export function SwitchElement(props: Omit<SwitchProps, "isSelected" | "onChange" | "onBlur" | "name">) {
  const field = useFieldContext<boolean>();
  return (
    <SwitchBase
      name={field.name}
      isSelected={field.state.value ?? false}
      onChange={(value) => field.handleChange(value)}
      onBlur={field.handleBlur}
      {...props}
    />
  );
}

export function SelectElement<T extends string = string>(
  props: Omit<SelectProps<T>, "selectedKey" | "onSelectionChange" | "onBlur" | "name" | "errorMessage">,
) {
  const field = useFieldContext<T>();
  const errorMessage = useFieldErrorMessage(field);
  return (
    <SelectBase
      name={field.name}
      selectedKey={field.state.value ?? null}
      onSelectionChange={(key) => field.handleChange(key as T)}
      onBlur={field.handleBlur}
      errorMessage={errorMessage}
      isInvalid={Boolean(errorMessage)}
      {...props}
    />
  );
}

export function ComboBoxElement<T extends string = string>(
  props: Omit<ComboBoxProps<T>, "selectedKey" | "onSelectionChange" | "onBlur" | "name" | "errorMessage">,
) {
  const field = useFieldContext<T>();
  const errorMessage = useFieldErrorMessage(field);
  return (
    <ComboBoxBase
      name={field.name}
      selectedKey={field.state.value ?? null}
      onSelectionChange={(key) => field.handleChange(key as T)}
      onBlur={field.handleBlur}
      errorMessage={errorMessage}
      isInvalid={Boolean(errorMessage)}
      {...props}
    />
  );
}

export function RadioGroupElement(props: Omit<RadioGroupProps, "value" | "onChange" | "onBlur" | "name" | "errorMessage">) {
  const field = useFieldContext<string>();
  const errorMessage = useFieldErrorMessage(field);
  return (
    <RadioGroupBase
      name={field.name}
      value={field.state.value ?? null}
      onChange={(value) => field.handleChange(value)}
      onBlur={field.handleBlur}
      errorMessage={errorMessage}
      isInvalid={Boolean(errorMessage)}
      {...props}
    />
  );
}
