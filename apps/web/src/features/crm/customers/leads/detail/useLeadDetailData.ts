"use client";

import { useQuery } from "@tanstack/react-query";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import {
  getCrmOptions,
  getLead,
  getLeadAttribution,
  getLeadConversionPreview,
  getLeadQualificationDetail,
  getLeadScoreDetail,
  getLeadStageDetail,
  getLeadStageReasons,
  getLeadTransitionGraph,
} from "../api/leads-api";
import { listConsentEvents } from "@/features/crm/setup/privacy-requests/api/privacy-requests-api";

// Every read the Lead detail screen makes, with its exact cache key and
// enabled condition. The stage-reasons and conversion-preview reads follow
// screen state (the stage being moved to, whether Convert is open), so the
// screen passes those in.
export function useLeadDetailData(
  leadId: string,
  pendingStageId: string,
  convertPreviewOpen: boolean,
) {
  const workspace = useWorkspaceContext();

  const leadQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "leads", leadId),
    queryFn: () => getLead(leadId),
  });
  const lead = leadQuery.data?.record;

  const optionsQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "options"),
    queryFn: getCrmOptions,
  });

  const stageDetailQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "leads", leadId, "stage-detail"),
    queryFn: () => getLeadStageDetail(leadId),
    enabled: Boolean(lead),
  });

  const transitionGraphQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "leads", "transition-graph"),
    queryFn: getLeadTransitionGraph,
  });

  const reasonsQuery = useQuery({
    queryKey: scopedQueryKey(
      workspace,
      "crm",
      "leads",
      leadId,
      "stage-reasons",
      pendingStageId,
    ),
    queryFn: () => getLeadStageReasons(leadId, pendingStageId),
    enabled: Boolean(pendingStageId),
  });

  const qualificationQuery = useQuery({
    queryKey: scopedQueryKey(
      workspace,
      "crm",
      "leads",
      leadId,
      "qualification",
    ),
    queryFn: () => getLeadQualificationDetail(leadId),
    enabled: Boolean(lead),
  });

  const scoreQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "leads", leadId, "score"),
    queryFn: () => getLeadScoreDetail(leadId),
    enabled: Boolean(lead),
  });

  const attributionQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "leads", leadId, "attribution"),
    queryFn: () => getLeadAttribution(leadId),
    enabled: Boolean(lead),
  });

  const consentQuery = useQuery({
    queryKey: scopedQueryKey(
      workspace,
      "crm",
      "leads",
      leadId,
      "consent-events",
    ),
    queryFn: () => listConsentEvents(leadId),
    enabled: Boolean(lead),
  });

  const convertPreviewQuery = useQuery({
    queryKey: scopedQueryKey(
      workspace,
      "crm",
      "leads",
      leadId,
      "convert-preview",
    ),
    queryFn: () => getLeadConversionPreview(leadId),
    enabled: convertPreviewOpen,
  });

  return {
    leadQuery,
    lead,
    optionsQuery,
    stageDetailQuery,
    transitionGraphQuery,
    reasonsQuery,
    qualificationQuery,
    scoreQuery,
    attributionQuery,
    consentQuery,
    convertPreviewQuery,
  };
}

export type LeadDetailData = ReturnType<typeof useLeadDetailData>;
