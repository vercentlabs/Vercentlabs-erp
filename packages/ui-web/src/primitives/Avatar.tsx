import { Avatar as BaseAvatar } from "@base-ui-components/react/avatar";
import type { ComponentProps } from "react";

import { cn } from "../utils/cn";

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export interface AvatarProps extends ComponentProps<typeof BaseAvatar.Root> {
  name: string;
  src?: string;
  size?: "compact" | "standard";
}

// Base UI's Avatar.Fallback automatically renders only once the image has
// failed to load or there is no src -- no manual onError state needed.
export function Avatar({ className, name, src, size = "standard", ...props }: AvatarProps) {
  return (
    <BaseAvatar.Root
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-pill)] bg-[var(--color-action-primary-soft)] text-[var(--color-action-primary)] font-medium",
        size === "compact" ? "size-6 text-[length:var(--text-xs)]" : "size-8 text-[length:var(--text-sm)]",
        className,
      )}
      {...props}
    >
      {src ? <BaseAvatar.Image src={src} alt="" className="size-full object-cover" /> : null}
      <BaseAvatar.Fallback>{initials(name)}</BaseAvatar.Fallback>
    </BaseAvatar.Root>
  );
}
