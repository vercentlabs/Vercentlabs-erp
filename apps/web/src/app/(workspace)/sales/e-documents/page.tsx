"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

// Sales › Deliver › E-invoices & E-way Bills opens To do for people with GST access, and the e-way bills made for everyone else.
export default function Page() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const gst = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("gst.view");
  useEffect(() => { router.replace(gst ? "/sales/gst-documents" : "/sales/eway-bills"); }, [gst, router]);
  return null;
}
