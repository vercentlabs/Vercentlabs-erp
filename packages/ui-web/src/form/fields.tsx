import { useId, useState } from "react";
import type { ReactNode } from "react";

import { FormField } from "../enterprise/FormField";
import { Checkbox } from "../primitives/Checkbox";
import { ComboboxContent, ComboboxInput, ComboboxItem, ComboboxRoot } from "../primitives/Combobox";
import { Input } from "../primitives/Input";
import { SelectContent, SelectItem, SelectRoot, SelectTrigger, SelectValue } from "../primitives/Select";
import { Textarea } from "../primitives/Textarea";
import { useFieldContext } from "./form-context";

// One real invariant every field component below shares: it reads the
// field's error/dirty/disabled state from TanStack Form (useFieldContext)
// and renders it through FormField's label/description/error wiring
// (SP032) -- none of these re-implement validation. Client-side schema
// validation is real UX polish (immediate feedback); it is explicitly NOT
// a replacement for backend domain validation -- see each field's
// docstring and docs/ux/UI_REWRITE_TRACKER.md's "do not duplicate domain
// validation" rule.
function fieldErrorMessage(errors: unknown[]): string | undefined {
  if (errors.length === 0) return undefined;
  const first = errors[0];
  if (typeof first === "string") return first;
  if (first && typeof first === "object" && "message" in first) return String((first as { message: unknown }).message);
  return String(first);
}

interface BaseFieldProps {
  label: ReactNode;
  description?: ReactNode;
  required?: boolean;
  disabled?: boolean;
  /** True once a field is known to be restricted by the caller's permissions rather than by validation -- renders read-only instead of hiding the field outright, so users understand *why* they can't edit it. */
  readOnlyReason?: string;
}

export function TextField({
  label,
  description,
  required,
  disabled,
  readOnlyReason,
  type = "text",
  placeholder,
}: BaseFieldProps & { type?: "text" | "email" | "tel" | "url"; placeholder?: string }) {
  const field = useFieldContext<string>();
  const error = field.state.meta.isTouched ? fieldErrorMessage(field.state.meta.errors) : undefined;
  return (
    <FormField label={label} description={readOnlyReason ?? description} required={required} error={error} disabled={disabled}>
      {(fieldProps) => (
        <Input
          {...fieldProps}
          type={type}
          name={field.name}
          value={field.state.value ?? ""}
          placeholder={placeholder}
          disabled={disabled || Boolean(readOnlyReason)}
          readOnly={Boolean(readOnlyReason)}
          invalid={Boolean(error)}
          onChange={(event) => field.handleChange(event.target.value)}
          onBlur={field.handleBlur}
        />
      )}
    </FormField>
  );
}

export function TextareaField({ label, description, required, disabled, readOnlyReason, placeholder, rows = 4 }: BaseFieldProps & { placeholder?: string; rows?: number }) {
  const field = useFieldContext<string>();
  const error = field.state.meta.isTouched ? fieldErrorMessage(field.state.meta.errors) : undefined;
  return (
    <FormField label={label} description={readOnlyReason ?? description} required={required} error={error} disabled={disabled}>
      {(fieldProps) => (
        <Textarea
          {...fieldProps}
          name={field.name}
          value={field.state.value ?? ""}
          placeholder={placeholder}
          rows={rows}
          disabled={disabled || Boolean(readOnlyReason)}
          readOnly={Boolean(readOnlyReason)}
          invalid={Boolean(error)}
          onChange={(event) => field.handleChange(event.target.value)}
          onBlur={field.handleBlur}
        />
      )}
    </FormField>
  );
}

export function NumberField({ label, description, required, disabled, readOnlyReason, min, max, step }: BaseFieldProps & { min?: number; max?: number; step?: number }) {
  const field = useFieldContext<number | null>();
  const error = field.state.meta.isTouched ? fieldErrorMessage(field.state.meta.errors) : undefined;
  return (
    <FormField label={label} description={readOnlyReason ?? description} required={required} error={error} disabled={disabled}>
      {(fieldProps) => (
        <Input
          {...fieldProps}
          type="number"
          name={field.name}
          value={field.state.value ?? ""}
          min={min}
          max={max}
          step={step}
          disabled={disabled || Boolean(readOnlyReason)}
          readOnly={Boolean(readOnlyReason)}
          invalid={Boolean(error)}
          onChange={(event) => field.handleChange(event.target.value === "" ? null : Number(event.target.value))}
          onBlur={field.handleBlur}
        />
      )}
    </FormField>
  );
}

function TemporalField({ label, description, required, disabled, readOnlyReason, kind }: BaseFieldProps & { kind: "date" | "datetime-local" }) {
  const field = useFieldContext<string>();
  const error = field.state.meta.isTouched ? fieldErrorMessage(field.state.meta.errors) : undefined;
  return (
    <FormField label={label} description={readOnlyReason ?? description} required={required} error={error} disabled={disabled}>
      {(fieldProps) => (
        <Input
          {...fieldProps}
          type={kind}
          name={field.name}
          value={field.state.value ?? ""}
          disabled={disabled || Boolean(readOnlyReason)}
          readOnly={Boolean(readOnlyReason)}
          invalid={Boolean(error)}
          onChange={(event) => field.handleChange(event.target.value)}
          onBlur={field.handleBlur}
        />
      )}
    </FormField>
  );
}

export function DateField(props: BaseFieldProps) {
  return <TemporalField {...props} kind="date" />;
}

export function DateTimeField(props: BaseFieldProps) {
  return <TemporalField {...props} kind="datetime-local" />;
}

export interface SelectFieldOption {
  value: string;
  label: ReactNode;
}

export function SelectField({
  label,
  description,
  required,
  disabled,
  readOnlyReason,
  options,
  placeholder = "Select...",
}: BaseFieldProps & { options: SelectFieldOption[]; placeholder?: string }) {
  const field = useFieldContext<string>();
  const error = field.state.meta.isTouched ? fieldErrorMessage(field.state.meta.errors) : undefined;
  return (
    <FormField label={label} description={readOnlyReason ?? description} required={required} error={error} disabled={disabled}>
      {(fieldProps) => (
        <SelectRoot
          value={field.state.value ?? null}
          disabled={disabled || Boolean(readOnlyReason)}
          onValueChange={(value) => field.handleChange(value as string)}
        >
          <SelectTrigger id={fieldProps.id} aria-invalid={fieldProps["aria-invalid"]} aria-describedby={fieldProps["aria-describedby"]} onBlur={field.handleBlur}>
            <SelectValue>{(value: string | null) => (value ? options.find((option) => option.value === value)?.label ?? value : placeholder)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </SelectRoot>
      )}
    </FormField>
  );
}

export interface ComboboxFieldItem {
  value: string;
  label: string;
}

// Backs both a plain searchable single-select and (via `onSearch`) an
// async entity lookup -- see EntityLookupField below, which is this
// component with a required async search function rather than a separate
// implementation.
export function ComboboxField({
  label,
  description,
  required,
  disabled,
  readOnlyReason,
  items,
  onSearch,
  placeholder = "Search...",
}: BaseFieldProps & { items?: ComboboxFieldItem[]; onSearch?: (query: string) => Promise<ComboboxFieldItem[]>; placeholder?: string }) {
  const field = useFieldContext<string | null>();
  const error = field.state.meta.isTouched ? fieldErrorMessage(field.state.meta.errors) : undefined;
  const [asyncItems, setAsyncItems] = useState<ComboboxFieldItem[]>(items ?? []);
  const [isSearching, setIsSearching] = useState(false);

  async function handleInputValueChange(query: string) {
    if (!onSearch) return;
    setIsSearching(true);
    try {
      setAsyncItems(await onSearch(query));
    } finally {
      setIsSearching(false);
    }
  }

  return (
    <FormField label={label} description={readOnlyReason ?? description} required={required} error={error} disabled={disabled}>
      {(fieldProps) => (
        <ComboboxRoot
          items={asyncItems}
          value={field.state.value}
          disabled={disabled || Boolean(readOnlyReason)}
          onValueChange={(value) => field.handleChange(value as string | null)}
          onInputValueChange={onSearch ? handleInputValueChange : undefined}
        >
          <ComboboxInput
            id={fieldProps.id}
            aria-invalid={fieldProps["aria-invalid"]}
            aria-describedby={fieldProps["aria-describedby"]}
            placeholder={isSearching ? "Searching..." : placeholder}
            onBlur={field.handleBlur}
          />
          <ComboboxContent>
            {asyncItems.map((item) => (
              <ComboboxItem key={item.value} value={item.value}>
                {item.label}
              </ComboboxItem>
            ))}
          </ComboboxContent>
        </ComboboxRoot>
      )}
    </FormField>
  );
}

/** A named preset of ComboboxField for record-lookup fields (lead owner, account, contact, ...) -- same component, named so screen code reads as intent ("look up an entity") rather than a generic search box. */
export function EntityLookupField(props: BaseFieldProps & { onSearch: (query: string) => Promise<ComboboxFieldItem[]>; placeholder?: string }) {
  return <ComboboxField {...props} />;
}

// A checkbox reads as a single-line "label to the right of the control"
// idiom, not FormField's usual "label above the control" -- so this
// renders its own label/description/error layout rather than routing
// through FormField, while still sharing fieldErrorMessage/id-generation
// conventions with every other field above.
export function CheckboxField({ label, description, disabled, indeterminate }: { label: ReactNode; description?: ReactNode; disabled?: boolean; indeterminate?: boolean }) {
  const field = useFieldContext<boolean>();
  const id = useId();
  const error = field.state.meta.isTouched ? fieldErrorMessage(field.state.meta.errors) : undefined;
  const describedBy = error || description ? `${id}-hint` : undefined;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="flex items-center gap-2 text-[length:var(--text-sm)] text-[var(--color-text-primary)]">
        <Checkbox
          id={id}
          checked={Boolean(field.state.value)}
          indeterminate={indeterminate}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onCheckedChange={(checked) => field.handleChange(Boolean(checked))}
          onBlur={field.handleBlur}
        />
        {label}
      </label>
      {description || error ? (
        <p id={describedBy} className={`pl-6 text-[length:var(--text-xs)] ${error ? "text-[var(--color-state-danger)]" : "text-[var(--color-text-muted)]"}`}>
          {error || description}
        </p>
      ) : null}
    </div>
  );
}

export function MultiSelectField({
  label,
  description,
  required,
  disabled,
  readOnlyReason,
  items,
}: BaseFieldProps & { items: ComboboxFieldItem[] }) {
  const field = useFieldContext<string[]>();
  const error = field.state.meta.isTouched ? fieldErrorMessage(field.state.meta.errors) : undefined;
  return (
    <FormField label={label} description={readOnlyReason ?? description} required={required} error={error} disabled={disabled}>
      {(fieldProps) => (
        <ComboboxRoot
          items={items}
          multiple
          value={field.state.value ?? []}
          disabled={disabled || Boolean(readOnlyReason)}
          onValueChange={(value) => field.handleChange(value as string[])}
        >
          <ComboboxInput
            id={fieldProps.id}
            aria-invalid={fieldProps["aria-invalid"]}
            aria-describedby={fieldProps["aria-describedby"]}
            onBlur={field.handleBlur}
          />
          <ComboboxContent>
            {items.map((item) => (
              <ComboboxItem key={item.value} value={item.value}>
                {item.label}
              </ComboboxItem>
            ))}
          </ComboboxContent>
        </ComboboxRoot>
      )}
    </FormField>
  );
}
