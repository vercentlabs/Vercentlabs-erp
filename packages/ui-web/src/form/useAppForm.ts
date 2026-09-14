import { createFormHook } from "@tanstack/react-form";

import { fieldContext, formContext } from "./form-context";
import {
  CheckboxField,
  ComboboxField,
  DateField,
  DateTimeField,
  EntityLookupField,
  MultiSelectField,
  NumberField,
  SelectField,
  TextareaField,
  TextField,
} from "./fields";
import { FormSubmitButton } from "./FormSubmitButton";

// The one bound form hook every module screen imports (per
// docs/ux/UI_REWRITE_TRACKER.md's TanStack Form + Zod architecture): each
// field type below is registered once here rather than every screen
// re-wiring useFieldContext itself. Usage: `const form = useAppForm({
// defaultValues, validators: { onChange: zodSchema }, onSubmit })`, then
// `<form.AppField name="email">{(f) => <f.TextField label="Email" />}</form.AppField>`.
export const { useAppForm, withForm } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: {
    TextField,
    TextareaField,
    NumberField,
    DateField,
    DateTimeField,
    SelectField,
    ComboboxField,
    EntityLookupField,
    MultiSelectField,
    CheckboxField,
  },
  formComponents: {
    FormSubmitButton,
  },
});
