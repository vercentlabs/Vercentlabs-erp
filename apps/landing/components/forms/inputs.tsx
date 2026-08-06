import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cx } from "@/lib/utils";

const FIELD_BASE =
  "h-11 w-full rounded-(--radius-control) border border-(--color-border-default) bg-(--color-bg-elevated) px-3.5 text-sm text-(--color-text-primary) placeholder:text-(--color-text-muted) transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-border-focus) disabled:cursor-not-allowed disabled:bg-(--color-bg-subtle) disabled:text-(--color-text-disabled) aria-[invalid=true]:border-(--color-border-error)";

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "className"> & {
  invalid?: boolean;
  className?: string;
};

export function Input({ invalid, className, ...rest }: InputProps) {
  return <input aria-invalid={invalid || undefined} className={cx(FIELD_BASE, className)} {...rest} />;
}

type TextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className"> & {
  invalid?: boolean;
  className?: string;
};

export function Textarea({ invalid, className, rows = 4, ...rest }: TextareaProps) {
  return (
    <textarea
      aria-invalid={invalid || undefined}
      rows={rows}
      className={cx(FIELD_BASE, "h-auto resize-y py-2.5", className)}
      {...rest}
    />
  );
}

type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "className"> & {
  invalid?: boolean;
  className?: string;
  children: ReactNode;
};

export function Select({ invalid, className, children, ...rest }: SelectProps) {
  return (
    <select aria-invalid={invalid || undefined} className={cx(FIELD_BASE, "pr-8", className)} {...rest}>
      {children}
    </select>
  );
}

interface CheckboxProps {
  id: string;
  label: ReactNode;
  name?: string;
  required?: boolean;
  defaultChecked?: boolean;
  className?: string;
}

export function Checkbox({ id, label, name, required, defaultChecked, className }: CheckboxProps) {
  return (
    <label htmlFor={id} className={cx("flex items-start gap-2.5 text-sm text-(--color-text-secondary)", className)}>
      <input
        id={id}
        name={name}
        type="checkbox"
        required={required}
        defaultChecked={defaultChecked}
        className="mt-0.5 h-4 w-4 flex-none rounded-[4px] border-(--color-border-strong) text-(--color-bg-brand) focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-border-focus)"
      />
      <span>{label}</span>
    </label>
  );
}

interface RadioOption {
  id: string;
  value: string;
  label: string;
}

export function RadioGroup({ name, options, legend }: { name: string; options: RadioOption[]; legend: string }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium text-(--color-text-primary)">{legend}</legend>
      {options.map((option) => (
        <label key={option.id} htmlFor={option.id} className="flex items-center gap-2.5 text-sm text-(--color-text-secondary)">
          <input
            id={option.id}
            name={name}
            type="radio"
            value={option.value}
            className="h-4 w-4 flex-none border-(--color-border-strong) text-(--color-bg-brand) focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-border-focus)"
          />
          {option.label}
        </label>
      ))}
    </fieldset>
  );
}
