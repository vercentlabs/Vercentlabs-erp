import { forwardRef } from "react";
import { Link as AriaLink, type LinkProps as AriaLinkProps } from "react-aria-components";
import { cn } from "../utilities/cn.ts";
import { buttonVariants } from "./Button.tsx";
import type { VariantProps } from "class-variance-authority";

export interface LinkButtonProps extends Omit<AriaLinkProps, "className">, VariantProps<typeof buttonVariants> {
  className?: string;
}

/** A navigation action styled like Button but rendering an anchor — use for
 * "go to record" / "open in new tab" style actions, not for submitting or
 * mutating anything (that's Button). */
export const LinkButton = forwardRef<HTMLAnchorElement, LinkButtonProps>(function LinkButton(
  { className, variant, size, ...props },
  ref,
) {
  return <AriaLink ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
});
