import { createFormHook } from "@tanstack/react-form";
import { fieldContext, formContext } from "./form-context.ts";
import {
  TextFieldElement,
  TextAreaElement,
  NumberFieldElement,
  MoneyFieldElement,
  PercentageFieldElement,
  QuantityFieldElement,
  CheckboxElement,
  SwitchElement,
  SelectElement,
  ComboBoxElement,
  RadioGroupElement,
} from "./fields.tsx";
import { SubmitButton } from "./SubmitButton.tsx";

/**
 * The one canonical form hook — every ERP form should build on
 * `useAppForm` from here rather than TanStack Form's bare `useForm`, so
 * every form gets the same field components and error/dirty/submit
 * behavior for free. Extend `fieldComponents` here (not per-feature) when
 * a genuinely new field type is needed across modules.
 */
export const { useAppForm, withForm } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: {
    TextField: TextFieldElement,
    TextArea: TextAreaElement,
    NumberField: NumberFieldElement,
    MoneyField: MoneyFieldElement,
    PercentageField: PercentageFieldElement,
    QuantityField: QuantityFieldElement,
    Checkbox: CheckboxElement,
    Switch: SwitchElement,
    Select: SelectElement,
    ComboBox: ComboBoxElement,
    RadioGroup: RadioGroupElement,
  },
  formComponents: {
    SubmitButton,
  },
});
