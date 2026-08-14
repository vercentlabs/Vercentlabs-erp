import Link from "next/link";
import { cx } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" width="30" height="30" className={className} aria-hidden="true">
      <rect x="1" y="1" width="38" height="38" rx="3" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M9.5 10.5h5.4l5.1 15 5.1-15h5.4L22 31h-4L9.5 10.5Z" fill="currentColor" />
      <path d="M5 5h6M5 5v6M35 35h-6M35 35v-6" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function Logo({ inverse = false, className }: { inverse?: boolean; className?: string }) {
  return (
    <Link
      href="/"
      className={cx(
        "inline-flex items-center gap-2.5 rounded-[3px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-border-focus)",
        inverse ? "text-white" : "text-(--color-text-primary)",
        className,
      )}
      aria-label="Vercentlabs — go to homepage"
    >
      <LogoMark />
      <span className="text-[0.98rem] font-bold tracking-[-0.035em]">Vercentlabs</span>
    </Link>
  );
}
