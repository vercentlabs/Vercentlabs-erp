import Link from "next/link";
import { ArrowLeft } from "lucide-react";

// The small "← Setup" link at the top of every CRM setup page.
export function SetupBackLink() {
  return (
    <Link href="/crm/settings" className="inline-flex w-fit items-center gap-1 text-sm text-text-secondary hover:text-text focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none">
      <ArrowLeft aria-hidden="true" className="size-4" />Setup
    </Link>
  );
}
