"use client";

// The two access reports: Role usage (each role, who holds it, when it last changed) and User access (each person, their roles and
// how much they can do, sensitive and privileged access flagged). Each downloads as CSV for an access review.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { Badge, Button, ErrorState } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";

import { getRoleUsageReport, getUserAccessReport } from "../api/roles-api";

const day = (value: string | null) => (value ? new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—");

function downloadCsv(fileName: string, header: string[], rows: Array<Array<string | number>>) {
  const cell = (value: string | number) => {
    const text = String(value ?? "");
    // A leading = + - @ would run as a formula in a spreadsheet.
    const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const csv = `﻿${[header, ...rows].map((line) => line.map(cell).join(",")).join("\r\n")}\r\n`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: fileName });
  link.click();
  URL.revokeObjectURL(url);
}

export function AccessReports({ appLabel, canSeeUsers }: { appLabel: (key: string) => string; canSeeUsers: boolean }) {
  const [report, setReport] = useState<"roles" | "users">("roles");
  const roles = useQuery({ queryKey: ["settings", "roles", "report"], queryFn: getRoleUsageReport, enabled: report === "roles" });
  const users = useQuery({ queryKey: ["settings", "users", "access-report"], queryFn: getUserAccessReport, enabled: report === "users" && canSeeUsers });
  const active = report === "roles" ? roles : users;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="radiogroup" aria-label="Report" className="flex gap-0.5 rounded-[var(--radius-control)] border border-border bg-surface-muted p-0.5">
          {([["roles", "Role usage"], ...(canSeeUsers ? [["users", "User access"]] : [])] as Array<[typeof report, string]>).map(([key, label]) => (
            <button key={key} type="button" role="radio" aria-checked={report === key} onClick={() => setReport(key)}
              className={`rounded-[calc(var(--radius-control)-2px)] px-3 py-1.5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-brand ${report === key ? "bg-surface text-brand shadow-sm" : "text-text-secondary hover:text-text"}`}>
              {label}
            </button>
          ))}
        </div>
        <Button variant="outline" size="compact" isDisabled={!active.data?.rows.length}
          onPress={() => {
            if (report === "roles" && roles.data)
              downloadCsv("role-usage.csv", ["Role", "App", "Risk", "Built-in", "People", "Permissions", "Last changed"],
                roles.data.rows.map((row) => [row.name, appLabel(row.module_key), row.risk_level, row.is_system ? "Yes" : "No", row.active_people, row.permission_count, day(row.last_changed_at)]));
            if (report === "users" && users.data)
              downloadCsv("user-access.csv", ["Name", "Email", "Status", "Roles", "Permissions", "Privileged", "Sensitive", "Last sign-in"],
                users.data.rows.map((row) => [row.name, row.email, row.status, row.roles.join("; "), row.permissionCount, row.privileged ? "Yes" : "No", row.sensitive ? "Yes" : "No", day(row.lastSignInAt)]));
          }}>
          <Download className="size-4" aria-hidden="true" />Download CSV
        </Button>
      </div>

      {active.isLoading ? <LoadingState label="Loading the report" rows={5} />
        : active.isError ? <ErrorState title="Could not load the report" description="Try again." action={{ label: "Retry", onPress: () => void active.refetch() }} />
        : report === "roles" ? (
          <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border bg-surface">
            <table className="w-full text-sm sm:min-w-[640px]">
              <thead className="bg-surface-muted text-left text-xs text-text-secondary">
                <tr><th className="px-3 py-2 font-semibold">Role</th><th className="hidden px-3 py-2 font-semibold sm:table-cell">App</th><th className="px-3 py-2 text-right font-semibold">People</th><th className="px-3 py-2 text-right font-semibold">Permissions</th><th className="hidden px-3 py-2 font-semibold sm:table-cell">Last changed</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(roles.data?.rows ?? []).map((row) => (
                  <tr key={row.id}>
                    <td className="px-3 py-2"><span className="font-medium text-text">{row.name}</span>{!row.is_system && <Badge tone="brand" className="ml-2">Custom</Badge>}</td>
                    <td className="hidden px-3 py-2 text-text-secondary sm:table-cell">{appLabel(row.module_key)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${row.active_people ? "font-medium text-text" : "text-text-muted"}`}>{row.active_people}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-text-secondary">{row.permission_count}</td>
                    <td className="hidden px-3 py-2 text-text-secondary sm:table-cell">{row.is_system && !row.last_changed_at ? "Built-in" : day(row.last_changed_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border bg-surface">
            <table className="w-full text-sm md:min-w-[720px]">
              <thead className="bg-surface-muted text-left text-xs text-text-secondary">
                <tr><th className="px-3 py-2 font-semibold">Person</th><th className="hidden px-3 py-2 font-semibold md:table-cell">Roles</th><th className="px-3 py-2 text-right font-semibold">Permissions</th><th className="px-3 py-2 font-semibold">Access</th><th className="hidden px-3 py-2 font-semibold md:table-cell">Last sign-in</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(users.data?.rows ?? []).map((row) => (
                  <tr key={row.userId}>
                    <td className="px-3 py-2">
                      <span className="block font-medium text-text">{row.name}{row.status !== "active" && <Badge tone="neutral" className="ml-2">{row.status === "disabled" ? "Disabled" : row.status}</Badge>}</span>
                      <span className="block text-xs text-text-secondary">{row.email}</span>
                      <span className="block text-xs text-text-muted md:hidden">{row.roles.join(", ") || "No role"}</span>
                    </td>
                    <td className="hidden px-3 py-2 text-text-secondary md:table-cell">{row.roles.join(", ") || "No role"}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-text-secondary">{row.permissionCount}</td>
                    <td className="px-3 py-2">{row.privileged ? <Badge tone="danger">Privileged</Badge> : row.sensitive ? <Badge tone="warning">Sensitive</Badge> : <Badge tone="success">Standard</Badge>}</td>
                    <td className="hidden px-3 py-2 text-text-secondary md:table-cell">{day(row.lastSignInAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  );
}
