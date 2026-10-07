import { forwardRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { TextField, type TextFieldProps } from "./TextField.tsx";

export type PasswordFieldProps = Omit<TextFieldProps, "type" | "suffix">;

/** A TextField for passwords with a show/hide toggle. The toggle keeps the
 * caret in the input (it never takes focus on click) and announces its state
 * through aria-pressed and its label. */
export const PasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(function PasswordField(props, ref) {
  const [visible, setVisible] = useState(false);
  const Icon = visible ? EyeOff : Eye;
  return (
    <TextField
      ref={ref}
      {...props}
      type={visible ? "text" : "password"}
      suffix={
        <button
          type="button"
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          disabled={props.isDisabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setVisible((current) => !current)}
          className="-mr-1 flex size-7 items-center justify-center rounded text-text-muted hover:text-text disabled:pointer-events-none"
        >
          <Icon className="size-4" aria-hidden="true" />
        </button>
      }
    />
  );
});
