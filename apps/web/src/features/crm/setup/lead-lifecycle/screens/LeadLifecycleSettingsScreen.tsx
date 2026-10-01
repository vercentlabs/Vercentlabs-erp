"use client";

import { PermissionState } from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { RecommendedTemplateSection } from "../components/RecommendedTemplateSection";
import { StagesSection } from "../components/StagesSection";
import { TransitionsSection } from "../components/TransitionsSection";
import { ReasonsSection } from "../components/ReasonsSection";

// F007 Tranche I (Stage A) — the REAL Lead lifecycle catalog/transition-
// graph setup UI. stage-catalog.js/transition-graph.js/stage-migration.js
// already governed the SAME crm_lead_stages/crm_lead_stage_transitions the
// Lead 360's own "Move to stage" UI already reads (getLeadTransitionGraph)
// — zero setup UI existed before this pass, confirmed by grep.
export function LeadLifecycleSettingsScreen() {
  const workspace = useWorkspaceContext();
  const canManage = workspace.permissions.includes(
    CRM_PERMISSIONS.settingsManage,
  );
  if (!canManage)
    return (
      <PermissionState
        title="You don't have access to CRM Setup"
        description="Ask an administrator to grant crm.settings.manage."
      />
    );

  return (
    <div className="flex flex-col gap-8">
      <p className="rounded-[var(--radius-control)] border border-border-strong bg-surface-muted px-3 py-2 text-sm text-text-secondary">
        Lead stage tracks where a prospect is in your engagement process.
        Qualification and conversion are tracked separately — a Lead&apos;s
        stage, its qualification decision and whether it has converted or been
        archived are three independent facts, never combined into one status.
      </p>
      <RecommendedTemplateSection />
      <StagesSection />
      <TransitionsSection />
      <ReasonsSection />
    </div>
  );
}
