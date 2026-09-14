import { notFound } from "next/navigation";

import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { PlatformGovernanceConsole } from "@/core/components/platform-governance-console";
import {
  listAiPolicies,
  listConfigurationVersions,
  listFeatureFlags,
  listPlatformReportDatasets,
  listPrivacyRequests,
  listReportDefinitions,
  listReportRuns,
  listRetentionPolicies,
  listTagDefinitions,
} from "@/core/shared-platform";

export const metadata = { title: "Platform governance" };
export const dynamic = "force-dynamic";

export default async function PlatformGovernancePage() {
  const session = await requireWorkspace();
  const capabilities = {
    configuration: hasPermission(session, PERMISSIONS.platformConfigurationManage),
    extensibility: hasPermission(session, PERMISSIONS.platformExtensibilityManage),
    privacy: hasPermission(session, PERMISSIONS.platformPrivacyManage),
    reports: hasPermission(session, PERMISSIONS.platformReportsManage),
    ai: hasPermission(session, PERMISSIONS.platformAiManage),
  };
  if (!Object.values(capabilities).some(Boolean)) notFound();

  const [configurations, featureFlags, retentionPolicies, privacyRequests, reportDefinitions, reportRuns, aiPolicies, tags] = await Promise.all([
    capabilities.configuration ? listConfigurationVersions(session.organizationId) : [],
    capabilities.configuration ? listFeatureFlags(session.organizationId) : [],
    capabilities.privacy ? listRetentionPolicies(session.organizationId) : [],
    capabilities.privacy ? listPrivacyRequests(session.organizationId) : [],
    capabilities.reports ? listReportDefinitions(session.organizationId) : [],
    capabilities.reports ? listReportRuns(session.organizationId) : [],
    capabilities.ai ? listAiPolicies(session.organizationId) : [],
    capabilities.extensibility ? listTagDefinitions(session.organizationId) : [],
  ]);

  const iso = (value: Date | null | undefined) => value?.toISOString() || null;
  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Administration · Shared platform</p>
          <h1>Platform governance</h1>
          <p>Operate effective-dated configuration, controlled extensibility, privacy, shared reporting and AI policy from one permission-gated workspace.</p>
        </div>
      </section>
      <PlatformGovernanceConsole
        capabilities={capabilities}
        configurations={configurations.map((row) => ({ ...row, effective_from: row.effective_from.toISOString(), effective_to: iso(row.effective_to), created_at: row.created_at.toISOString() }))}
        featureFlags={featureFlags.map((row) => ({ ...row, effective_from: row.effective_from.toISOString(), effective_to: iso(row.effective_to), updated_at: row.updated_at.toISOString() }))}
        retentionPolicies={retentionPolicies.map((row) => ({ ...row, effective_from: row.effective_from.toISOString(), effective_to: iso(row.effective_to), created_at: row.created_at.toISOString() }))}
        privacyRequests={privacyRequests.map((row) => ({ ...row, requested_at: row.requested_at.toISOString(), completed_at: iso(row.completed_at), updated_at: row.updated_at.toISOString() }))}
        reportDefinitions={reportDefinitions.map((row) => ({ ...row, updated_at: row.updated_at.toISOString() }))}
        reportRuns={reportRuns.map((row) => ({ ...row, requested_at: row.requested_at.toISOString(), completed_at: iso(row.completed_at) }))}
        reportDatasets={capabilities.reports ? listPlatformReportDatasets(session) : []}
        aiPolicies={aiPolicies.map((row) => ({ ...row, updated_at: row.updated_at.toISOString() }))}
        tags={tags.map((row) => ({ ...row, updated_at: row.updated_at.toISOString() }))}
      />
    </>
  );
}
