import { forwardRef, type ReactNode } from "react";
import { Link as AriaLink, type LinkProps as AriaLinkProps } from "react-aria-components";
import { cn } from "../utilities/cn.ts";
import { iconButtonVariants } from "./IconButton.tsx";
import type { VariantProps } from "class-variance-authority";

export interface IconLinkButtonProps
  extends Omit<AriaLinkProps, "className" | "children">,
    VariantProps<typeof iconButtonVariants> {
  className?: string;
  children: ReactNode;
  "aria-label": string;
}

/** IconButton's anchor counterpart — for a download/open-in-new-tab icon
 * action (needs a real href, not an onPress). See IconButton for the
 * button case. */
export const IconLinkButton = forwardRef<HTMLAnchorElement, IconLinkButtonProps>(function IconLinkButton(
  { className, variant, size, children, ...props },
  ref,
) {
  return (
    <AriaLink ref={ref} className={cn(iconButtonVariants({ variant, size }), className)} {...props}>
      {children}
    </AriaLink>
  );
});
