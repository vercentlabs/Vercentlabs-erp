"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import AppIcon from "@/components/app-icon";
import { BREADCRUMB_LABELS } from "@/lib/navigation/breadcrumb-labels";

function titleFromSegment(segment: string) {
  if (BREADCRUMB_LABELS[segment]) return BREADCRUMB_LABELS[segment];
  if (/^[0-9a-f-]{24,}$/i.test(segment)) return "Record";
  return segment.replaceAll("-", " ");
}

export default function Breadcrumbs() {
  const pathname = usePathname();
  const parts = pathname.split("/").filter(Boolean);

  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      <ol>
        <li>
          <Link href="/dashboard" aria-label="Home">
            <AppIcon name="dashboard" size={14} />
            <span>Home</span>
          </Link>
        </li>
        {parts.map((part, index) => {
          const href = `/${parts.slice(0, index + 1).join("/")}`;
          const last = index === parts.length - 1;
          const label = titleFromSegment(part);

          if (part === "dashboard" && index === 0) return null;

          return (
            <li key={href}>
              <span className="breadcrumb-separator" aria-hidden="true">
                <AppIcon name="chevron-down" size={12} />
              </span>
              {last ? (
                <span aria-current="page">{label}</span>
              ) : (
                <Link href={href}>{label}</Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
