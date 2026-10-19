"use client";

// On Home, for the owner or an administrator of a company that has not finished setup: how far along it is, and a link back.
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { getSetup } from "@/features/settings/company/company-api";

export function SetupBanner() {
  const query = useQuery({ queryKey: ["settings", "company", "setup"], queryFn: getSetup, staleTime: 60_000 });
  const setup = query.data?.setup;
  if (!setup || setup.completedAt) return null;
  const done = setup.steps.filter((step) => step.done).length;
  return (
    <div className="flex w-full flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-brand/40 bg-brand-soft p-4 text-sm">
      <span>{`Finish setting up your company: ${done} of ${setup.steps.length} steps done.`}</span>
      <Link className="font-medium text-brand hover:underline" href="/setup">Continue setup</Link>
    </div>
  );
}
