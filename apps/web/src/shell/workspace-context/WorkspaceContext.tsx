"use client";

import { createContext, useContext, type ReactNode } from "react";

import { setDisplayTimeZone } from "@/shared/format/display-time-zone";

// Client-side view of the server-resolved workspace context.
// Deliberately narrow and serializable — only what client components need
// to render nav state / gate interactive affordances. It is NOT the
// authority: every mutating action still re-checks permission/entitlement
// server-side (services/api's module-entitlements.js /
// access-control-runtime.js), this is presentation-layer convenience only.
export type WorkspaceContextValue = {
  organizationId: string;
  organizationName: string | null;
  userId: string;
  fullName: string;
  email: string;
  locale: string;
  timezone: string;
  roleSlugs: string[];
  permissions: string[];
  accessibleModuleKeys: string[];
};

const WorkspaceReactContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceContextProvider({
  value,
  children,
}: {
  value: WorkspaceContextValue;
  children: ReactNode;
}) {
  // Times show in the person's time zone (else the organization's), not the browser's — set before any child renders.
  setDisplayTimeZone(value.timezone);
  return (
    <WorkspaceReactContext.Provider value={value}>
      {children}
    </WorkspaceReactContext.Provider>
  );
}

export function useWorkspaceContext() {
  const context = useContext(WorkspaceReactContext);
  if (!context) {
    throw new Error(
      "useWorkspaceContext must be used within a WorkspaceContextProvider.",
    );
  }
  return context;
}
