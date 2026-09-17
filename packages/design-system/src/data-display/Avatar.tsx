import { forwardRef, useState } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../utilities/cn.ts";

const avatarVariants = cva("inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-soft font-medium text-brand-active", {
  variants: {
    size: {
      xs: "size-6 text-[10px]",
      sm: "size-8 text-xs",
      md: "size-10 text-sm",
      lg: "size-12 text-base",
    },
  },
  defaultVariants: { size: "md" },
});

export interface AvatarProps extends VariantProps<typeof avatarVariants> {
  className?: string;
  /** The person/entity's full name — used for the fallback initials and
   * as the accessible name. Required even when `src` is given, in case
   * the image fails to load. */
  name: string;
  src?: string;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

export const Avatar = forwardRef<HTMLSpanElement, AvatarProps>(function Avatar({ className, size, name, src }, ref) {
  const [imageFailed, setImageFailed] = useState(false);
  return (
    <span ref={ref} role="img" aria-label={name} className={cn(avatarVariants({ size }), className)}>
      {src && !imageFailed ? (
        <img src={src} alt="" className="size-full object-cover" onError={() => setImageFailed(true)} />
      ) : (
        initials(name)
      )}
    </span>
  );
});
