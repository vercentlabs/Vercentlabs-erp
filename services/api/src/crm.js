import { CRM_RESOURCE_KEYS } from "@vercent/shared-types";

const resourceSet = new Set(CRM_RESOURCE_KEYS);

export class CrmError extends Error {
  constructor(status, message, code = "CRM_ERROR") {
    super(message);
    this.name = "CrmError";
    this.status = status;
    this.code = code;
  }
}

const resources = Object.freeze({
  leads: {
    table: "tenant.crm_leads",
    codeEntity: "crm_lead",
    codeField: "code",
    search: [
      "code",
      "first_name",
      "last_name",
      "email",
      "phone",
      "mobile",
      "company_name",
      "product_interest",
    ],
    orderBy: "updated_at DESC, created_at DESC",
    statusColumn: "status",
    companyScoped: true,
    fields: {
      companyId: "company_id",
      branchId: "branch_id",
      code: "code",
      firstName: "first_name",
      lastName: "last_name",
      email: "email",
      phone: "phone",
      mobile: "mobile",
      companyName: "company_name",
      jobTitle: "job_title",
      website: "website",
      industry: "industry",
      sourceId: "source_id",
      campaignId: "campaign_id",
      status: "status",
      priority: "priority",
      rating: "rating",
      ownerUserId: "owner_user_id",
      score: "score",
      estimatedValue: "estimated_value",
      currencyCode: "currency_code",
      city: "city",
      state: "state",
      countryCode: "country_code",
      productInterest: "product_interest",
      nextFollowUpAt: "next_follow_up_at",
      consentEmail: "consent_email",
      consentSms: "consent_sms",
      consentWhatsapp: "consent_whatsapp",
      doNotContact: "do_not_contact",
      unqualifiedReason: "unqualified_reason",
      customData: "custom_data",
    },
  },
  opportunities: {
    table: "tenant.crm_opportunities",
    codeEntity: "crm_opportunity",
    codeField: "code",
    search: ["code", "name", "description", "next_step", "loss_notes"],
    orderBy: "expected_close_date ASC NULLS LAST, updated_at DESC",
    statusColumn: "status",
    companyScoped: true,
    fields: {
      companyId: "company_id",
      branchId: "branch_id",
      code: "code",
      pipelineId: "pipeline_id",
      stageId: "stage_id",
      leadId: "lead_id",
      partyId: "party_id",
      contactId: "contact_id",
      campaignId: "campaign_id",
      sourceId: "source_id",
      ownerUserId: "owner_user_id",
      name: "name",
      description: "description",
      amount: "amount",
      currencyCode: "currency_code",
      probability: "probability",
      expectedCloseDate: "expected_close_date",
      actualCloseDate: "actual_close_date",
      status: "status",
      forecastCategory: "forecast_category",
      nextStep: "next_step",
      lostReasonId: "lost_reason_id",
      lossNotes: "loss_notes",
      customData: "custom_data",
    },
  },
  activities: {
    table: "tenant.crm_activities",
    search: ["subject", "description", "outcome", "location"],
    orderBy: "COALESCE(due_at, start_at, created_at) ASC, created_at DESC",
    statusColumn: "status",
    companyScoped: true,
    fields: {
      companyId: "company_id",
      branchId: "branch_id",
      entityType: "entity_type",
      entityId: "entity_id",
      activityType: "activity_type",
      subject: "subject",
      description: "description",
      status: "status",
      priority: "priority",
      assignedTo: "assigned_to",
      startAt: "start_at",
      dueAt: "due_at",
      endAt: "end_at",
      reminderAt: "reminder_at",
      outcome: "outcome",
      location: "location",
      recurringRule: "recurring_rule",
    },
  },
  campaigns: {
    table: "tenant.crm_campaigns",
    codeEntity: "crm_campaign",
    codeField: "code",
    search: ["code", "name", "description", "campaign_type"],
    orderBy: "start_date DESC NULLS LAST, created_at DESC",
    statusColumn: "status",
    companyScoped: true,
    fields: {
      companyId: "company_id",
      code: "code",
      name: "name",
      campaignType: "campaign_type",
      status: "status",
      startDate: "start_date",
      endDate: "end_date",
      budget: "budget",
      expectedRevenue: "expected_revenue",
      actualCost: "actual_cost",
      ownerUserId: "owner_user_id",
      description: "description",
    },
  },
  communications: {
    table: "tenant.crm_communications",
    search: [
      "subject",
      "body",
      "from_address",
      "provider",
      "provider_message_id",
    ],
    orderBy: "occurred_at DESC, created_at DESC",
    statusColumn: "status",
    companyScoped: false,
    fields: {
      channel: "channel",
      direction: "direction",
      leadId: "lead_id",
      opportunityId: "opportunity_id",
      partyId: "party_id",
      contactId: "contact_id",
      provider: "provider",
      providerMessageId: "provider_message_id",
      subject: "subject",
      body: "body",
      fromAddress: "from_address",
      toAddresses: "to_addresses",
      status: "status",
      occurredAt: "occurred_at",
      metadata: "metadata",
    },
  },
  pipelines: {
    table: "tenant.crm_pipelines",
    search: ["name", "code", "description"],
    orderBy: "is_default DESC, name ASC",
    statusColumn: "status",
    companyScoped: true,
    fields: {
      companyId: "company_id",
      name: "name",
      code: "code",
      description: "description",
      isDefault: "is_default",
      status: "status",
    },
  },
  stages: {
    table: "tenant.crm_pipeline_stages",
    search: ["name", "code", "forecast_category"],
    orderBy: "pipeline_id ASC, sequence ASC",
    statusColumn: "status",
    companyScoped: false,
    fields: {
      pipelineId: "pipeline_id",
      name: "name",
      code: "code",
      sequence: "sequence",
      probability: "probability",
      forecastCategory: "forecast_category",
      isWon: "is_won",
      isLost: "is_lost",
      staleAfterDays: "stale_after_days",
      status: "status",
    },
  },
  sources: {
    table: "tenant.crm_lead_sources",
    search: ["name", "code", "channel"],
    orderBy: "is_default DESC, name ASC",
    statusColumn: "status",
    companyScoped: false,
    fields: {
      name: "name",
      code: "code",
      channel: "channel",
      isDefault: "is_default",
      status: "status",
    },
  },
  "lost-reasons": {
    table: "tenant.crm_lost_reasons",
    search: ["name", "code", "category"],
    orderBy: "category ASC, name ASC",
    statusColumn: "status",
    companyScoped: false,
    fields: {
      name: "name",
      code: "code",
      category: "category",
      status: "status",
    },
  },
  tags: {
    table: "tenant.crm_tags",
    search: ["name", "color"],
    orderBy: "name ASC",
    statusColumn: "status",
    companyScoped: false,
    fields: { name: "name", color: "color", status: "status" },
  },
  "scoring-rules": {
    table: "tenant.crm_scoring_rules",
    search: ["name", "field_name", "operator"],
    orderBy: "sequence ASC, name ASC",
    statusColumn: "status",
    companyScoped: false,
    fields: {
      name: "name",
      sequence: "sequence",
      fieldName: "field_name",
      operator: "operator",
      comparisonValue: "comparison_value",
      points: "points",
      status: "status",
    },
  },
  "assignment-rules": {
    table: "tenant.crm_assignment_rules",
    search: ["name", "assignment_mode"],
    orderBy: "sequence ASC, name ASC",
    statusColumn: "status",
    companyScoped: false,
    fields: {
      name: "name",
      sequence: "sequence",
      criteria: "criteria",
      assignmentMode: "assignment_mode",
      assigneeUserId: "assignee_user_id",
      roundRobinUserIds: "round_robin_user_ids",
      status: "status",
    },
  },
  sequences: {
    table: "tenant.crm_sequences",
    search: ["name", "description"],
    orderBy: "updated_at DESC, name ASC",
    statusColumn: "status",
    companyScoped: false,
    fields: {
      name: "name",
      description: "description",
      ownerUserId: "owner_user_id",
      status: "status",
    },
  },
  "sequence-steps": {
    table: "tenant.crm_sequence_steps",
    search: ["subject_template", "body_template", "action_type"],
    orderBy: "sequence_id ASC, step_order ASC",
    companyScoped: false,
    fields: {
      sequenceId: "sequence_id",
      stepOrder: "step_order",
      delayMinutes: "delay_minutes",
      actionType: "action_type",
      subjectTemplate: "subject_template",
      bodyTemplate: "body_template",
      assignedToOwner: "assigned_to_owner",
    },
  },
  "sequence-enrollments": {
    table: "tenant.crm_sequence_enrollments",
    search: ["status"],
    orderBy: "next_run_at ASC NULLS LAST, enrolled_at DESC",
    statusColumn: "status",
    companyScoped: false,
    fields: {
      sequenceId: "sequence_id",
      leadId: "lead_id",
      contactId: "contact_id",
      opportunityId: "opportunity_id",
      currentStep: "current_step",
      nextRunAt: "next_run_at",
      status: "status",
      enrolledBy: "enrolled_by",
    },
  },
  "automation-rules": {
    table: "tenant.crm_automation_rules",
    search: ["name", "event_type"],
    orderBy: "sequence ASC, name ASC",
    statusColumn: "status",
    companyScoped: false,
    fields: {
      name: "name",
      eventType: "event_type",
      sequence: "sequence",
      conditions: "conditions",
      actions: "actions",
      status: "status",
    },
  },
  "capture-forms": {
    table: "tenant.crm_capture_forms",
    search: ["name", "public_key", "success_message"],
    orderBy: "status ASC, name ASC",
    statusColumn: "status",
    companyScoped: true,
    fields: {
      companyId: "company_id",
      branchId: "branch_id",
      name: "name",
      sourceId: "source_id",
      campaignId: "campaign_id",
      ownerUserId: "owner_user_id",
      allowedOrigins: "allowed_origins",
      requiredFields: "required_fields",
      successMessage: "success_message",
      rateLimitPerHour: "rate_limit_per_hour",
      status: "status",
    },
  },
  competitors: {
    table: "tenant.crm_competitors",
    search: ["name", "website", "strengths", "weaknesses"],
    orderBy: "name ASC",
    statusColumn: "status",
    companyScoped: false,
    fields: {
      name: "name",
      website: "website",
      strengths: "strengths",
      weaknesses: "weaknesses",
      status: "status",
    },
  },
  "forecast-targets": {
    table: "tenant.crm_forecast_targets",
    search: ["currency_code"],
    orderBy: "period_start DESC, user_id NULLS FIRST",
    companyScoped: true,
    fields: {
      companyId: "company_id",
      userId: "user_id",
      periodStart: "period_start",
      periodEnd: "period_end",
      currencyCode: "currency_code",
      targetAmount: "target_amount",
    },
  },
  integrations: {
    table: "tenant.crm_integrations",
    search: ["provider", "display_name", "status"],
    orderBy: "provider ASC, display_name ASC",
    statusColumn: "status",
    companyScoped: false,
    fields: {
      provider: "provider",
      displayName: "display_name",
      credentialReference: "credential_reference",
      configuration: "configuration",
      status: "status",
    },
  },
  "webhook-subscriptions": {
    table: "tenant.crm_webhook_subscriptions",
    search: ["name", "endpoint_url"],
    orderBy: "name ASC",
    statusColumn: "status",
    companyScoped: false,
    fields: {
      name: "name",
      endpointUrl: "endpoint_url",
      eventTypes: "event_types",
      secretReference: "secret_reference",
      status: "status",
    },
  },
  "sales-teams": {
    table: "tenant.crm_sales_teams",
    search: ["code", "name"],
    orderBy: "name ASC",
    statusColumn: "status",
    companyScoped: true,
    fields: {
      companyId: "company_id",
      parentTeamId: "parent_team_id",
      code: "code",
      name: "name",
      managerUserId: "manager_user_id",
      defaultPipelineId: "default_pipeline_id",
      currencyCode: "currency_code",
      status: "status",
    },
  },
  "sales-team-members": {
    table: "tenant.crm_sales_team_members",
    search: ["member_role", "status"],
    orderBy: "effective_from DESC, created_at DESC",
    statusColumn: "status",
    companyScoped: true,
    fields: {
      companyId: "company_id",
      teamId: "team_id",
      userId: "user_id",
      memberRole: "member_role",
      allocationPercent: "allocation_percent",
      effectiveFrom: "effective_from",
      effectiveTo: "effective_to",
      status: "status",
    },
  },
  territories: {
    table: "tenant.crm_territories",
    search: ["code", "name", "territory_type"],
    orderBy: "name ASC",
    statusColumn: "status",
    companyScoped: true,
    fields: {
      companyId: "company_id",
      parentTerritoryId: "parent_territory_id",
      code: "code",
      name: "name",
      territoryType: "territory_type",
      managerUserId: "manager_user_id",
      assignmentRules: "assignment_rules",
      status: "status",
    },
  },
  "territory-assignments": {
    table: "tenant.crm_territory_assignments",
    search: ["assignee_type", "assignment_role", "source"],
    orderBy: "effective_from DESC, created_at DESC",
    companyScoped: true,
    fields: {
      companyId: "company_id",
      territoryId: "territory_id",
      assigneeType: "assignee_type",
      assigneeId: "assignee_id",
      assignmentRole: "assignment_role",
      effectiveFrom: "effective_from",
      effectiveTo: "effective_to",
      source: "source",
    },
  },
  "quota-plans": {
    table: "tenant.crm_quota_plans",
    search: ["name", "quota_type"],
    orderBy: "period_start DESC, name ASC",
    statusColumn: "status",
    companyScoped: true,
    fields: {
      companyId: "company_id",
      teamId: "team_id",
      territoryId: "territory_id",
      userId: "user_id",
      name: "name",
      quotaType: "quota_type",
      periodStart: "period_start",
      periodEnd: "period_end",
      currencyCode: "currency_code",
      targetAmount: "target_amount",
      stretchAmount: "stretch_amount",
      status: "status",
    },
  },
  "forecast-periods": {
    table: "tenant.crm_forecast_periods",
    search: ["name", "period_type"],
    orderBy: "period_start DESC",
    statusColumn: "status",
    companyScoped: true,
    fields: {
      companyId: "company_id",
      name: "name",
      periodType: "period_type",
      periodStart: "period_start",
      periodEnd: "period_end",
      currencyCode: "currency_code",
      freezeAt: "freeze_at",
      status: "status",
    },
  },
  "forecast-submissions": {
    table: "tenant.crm_forecast_submissions",
    search: ["status", "notes"],
    orderBy: "updated_at DESC",
    statusColumn: "status",
    companyScoped: true,
    fields: {
      companyId: "company_id",
      periodId: "period_id",
      teamId: "team_id",
      territoryId: "territory_id",
      ownerUserId: "owner_user_id",
      pipelineAmount: "pipeline_amount",
      bestCaseAmount: "best_case_amount",
      commitAmount: "commit_amount",
      closedAmount: "closed_amount",
      managerAdjustment: "manager_adjustment",
      currencyCode: "currency_code",
      confidencePercent: "confidence_percent",
      notes: "notes",
      status: "status",
    },
  },
  "account-plans": {
    table: "tenant.crm_account_plans",
    search: ["account_tier", "lifecycle_stage", "health_status"],
    orderBy: "next_review_at ASC NULLS LAST, updated_at DESC",
    statusColumn: "status",
    companyScoped: true,
    fields: {
      companyId: "company_id",
      partyId: "party_id",
      ownerUserId: "owner_user_id",
      executiveSponsorUserId: "executive_sponsor_user_id",
      accountTier: "account_tier",
      lifecycleStage: "lifecycle_stage",
      objectives: "objectives",
      risks: "risks",
      whiteSpace: "white_space",
      successPlan: "success_plan",
      renewalDate: "renewal_date",
      annualRevenue: "annual_revenue",
      potentialRevenue: "potential_revenue",
      healthScore: "health_score",
      healthStatus: "health_status",
      lastReviewedAt: "last_reviewed_at",
      nextReviewAt: "next_review_at",
      status: "status",
    },
  },
  "account-stakeholders": {
    table: "tenant.crm_account_stakeholders",
    search: ["name", "title", "stakeholder_role", "sentiment"],
    orderBy: "influence_level DESC, name ASC",
    statusColumn: "status",
    companyScoped: true,
    fields: {
      companyId: "company_id",
      accountPlanId: "account_plan_id",
      contactId: "contact_id",
      name: "name",
      title: "title",
      stakeholderRole: "stakeholder_role",
      influenceLevel: "influence_level",
      sentiment: "sentiment",
      relationshipOwnerUserId: "relationship_owner_user_id",
      engagementScore: "engagement_score",
      notes: "notes",
      status: "status",
    },
  },
  playbooks: {
    table: "tenant.crm_playbooks",
    search: ["name", "framework", "description"],
    orderBy: "name ASC",
    statusColumn: "status",
    companyScoped: true,
    fields: {
      companyId: "company_id",
      pipelineId: "pipeline_id",
      name: "name",
      framework: "framework",
      description: "description",
      guidance: "guidance",
      status: "status",
    },
  },
  "playbook-questions": {
    table: "tenant.crm_playbook_questions",
    search: ["question_key", "prompt", "response_type"],
    orderBy: "sequence ASC, prompt ASC",
    statusColumn: "status",
    companyScoped: true,
    fields: {
      companyId: "company_id",
      playbookId: "playbook_id",
      stageId: "stage_id",
      questionKey: "question_key",
      prompt: "prompt",
      responseType: "response_type",
      responseOptions: "response_options",
      required: "required",
      blocksStageExit: "blocks_stage_exit",
      sequence: "sequence",
      scoringWeight: "scoring_weight",
      status: "status",
    },
  },
  "playbook-responses": {
    table: "tenant.crm_playbook_responses",
    search: ["source"],
    orderBy: "responded_at DESC",
    companyScoped: true,
    fields: {
      companyId: "company_id",
      playbookId: "playbook_id",
      questionId: "question_id",
      opportunityId: "opportunity_id",
      leadId: "lead_id",
      response: "response",
      respondedBy: "responded_by",
      respondedAt: "responded_at",
      source: "source",
    },
  },
  "consent-events": {
    table: "tenant.crm_consent_events",
    search: ["channel", "purpose", "action", "source"],
    orderBy: "occurred_at DESC",
    companyScoped: true,
    fields: {
      companyId: "company_id",
      leadId: "lead_id",
      contactId: "contact_id",
      partyId: "party_id",
      channel: "channel",
      purpose: "purpose",
      action: "action",
      lawfulBasis: "lawful_basis",
      source: "source",
      evidence: "evidence",
      occurredAt: "occurred_at",
      expiresAt: "expires_at",
    },
  },
  "privacy-requests": {
    table: "tenant.crm_privacy_requests",
    search: [
      "request_type",
      "subject_type",
      "requester_name",
      "requester_email",
      "status",
    ],
    orderBy: "due_at ASC, created_at DESC",
    statusColumn: "status",
    companyScoped: true,
    fields: {
      companyId: "company_id",
      requestType: "request_type",
      subjectType: "subject_type",
      subjectId: "subject_id",
      requesterName: "requester_name",
      requesterEmail: "requester_email",
      identityVerifiedAt: "identity_verified_at",
      dueAt: "due_at",
      status: "status",
      resolutionNotes: "resolution_notes",
      completedAt: "completed_at",
      assignedTo: "assigned_to",
    },
  },
  "data-quality-scores": {
    table: "tenant.crm_data_quality_scores",
    search: ["entity_type", "calculation_version"],
    orderBy: "overall_score ASC, calculated_at DESC",
    companyScoped: true,
    fields: {
      companyId: "company_id",
      entityType: "entity_type",
      entityId: "entity_id",
      completenessScore: "completeness_score",
      validityScore: "validity_score",
      freshnessScore: "freshness_score",
      duplicateRiskScore: "duplicate_risk_score",
      overallScore: "overall_score",
      issues: "issues",
      calculatedAt: "calculated_at",
      calculationVersion: "calculation_version",
    },
  },
  "engagement-templates": {
    table: "tenant.crm_engagement_templates",
    search: ["name", "subject_template", "body_template", "template_type"],
    orderBy: "updated_at DESC, name ASC",
    statusColumn: "status",
    companyScoped: true,
    fields: {
      companyId: "company_id",
      templateType: "template_type",
      name: "name",
      subjectTemplate: "subject_template",
      bodyTemplate: "body_template",
      languageCode: "language_code",
      ownerUserId: "owner_user_id",
      isShared: "is_shared",
      version: "version",
      metadata: "metadata",
      status: "status",
    },
  },
  "meeting-links": {
    table: "tenant.crm_meeting_links",
    search: ["name", "slug", "meeting_provider", "location_template"],
    orderBy: "status ASC, name ASC",
    statusColumn: "status",
    companyScoped: true,
    fields: {
      companyId: "company_id",
      ownerUserId: "owner_user_id",
      name: "name",
      slug: "slug",
      durationMinutes: "duration_minutes",
      bufferBeforeMinutes: "buffer_before_minutes",
      bufferAfterMinutes: "buffer_after_minutes",
      timezone: "timezone",
      availability: "availability",
      meetingProvider: "meeting_provider",
      locationTemplate: "location_template",
      status: "status",
    },
  },
  "sync-accounts": {
    table: "tenant.crm_sync_accounts",
    search: [
      "provider",
      "display_name",
      "external_account_id",
      "status",
      "last_error",
    ],
    orderBy: "updated_at DESC",
    statusColumn: "status",
    companyScoped: true,
    fields: {
      companyId: "company_id",
      userId: "user_id",
      provider: "provider",
      externalAccountId: "external_account_id",
      displayName: "display_name",
      credentialReference: "credential_reference",
      scopes: "scopes",
      syncDirection: "sync_direction",
      syncCursor: "sync_cursor",
      lastSyncedAt: "last_synced_at",
      lastError: "last_error",
      status: "status",
    },
  },
  conversations: {
    table: "tenant.crm_conversations",
    search: ["title", "provider", "external_id", "channel", "status"],
    orderBy: "started_at DESC",
    statusColumn: "status",
    companyScoped: true,
    fields: {
      companyId: "company_id",
      leadId: "lead_id",
      opportunityId: "opportunity_id",
      partyId: "party_id",
      contactId: "contact_id",
      communicationId: "communication_id",
      channel: "channel",
      provider: "provider",
      externalId: "external_id",
      title: "title",
      startedAt: "started_at",
      endedAt: "ended_at",
      recordingReference: "recording_reference",
      transcriptStatus: "transcript_status",
      consentStatus: "consent_status",
      retentionUntil: "retention_until",
      metadata: "metadata",
      status: "status",
    },
  },
  "conversation-insights": {
    table: "tenant.crm_conversation_insights",
    search: ["title", "content", "insight_type", "review_status"],
    orderBy: "created_at DESC",
    statusColumn: "review_status",
    companyScoped: true,
    fields: {
      companyId: "company_id",
      conversationId: "conversation_id",
      insightType: "insight_type",
      title: "title",
      content: "content",
      score: "score",
      evidence: "evidence",
      modelProvider: "model_provider",
      modelName: "model_name",
      requiresReview: "requires_review",
      reviewedBy: "reviewed_by",
      reviewedAt: "reviewed_at",
      reviewStatus: "review_status",
    },
  },
  "pipeline-inspections": {
    table: "tenant.crm_pipeline_inspections",
    search: ["health_status", "calculation_version"],
    orderBy: "inspected_at DESC",
    companyScoped: true,
    fields: {
      companyId: "company_id",
      opportunityId: "opportunity_id",
      inspectedAt: "inspected_at",
      stageAgeDays: "stage_age_days",
      daysSinceActivity: "days_since_activity",
      closeDateSlipDays: "close_date_slip_days",
      amountChange: "amount_change",
      probabilityChange: "probability_change",
      healthScore: "health_score",
      healthStatus: "health_status",
      issues: "issues",
      recommendedActions: "recommended_actions",
      calculationVersion: "calculation_version",
    },
  },
  "deal-risks": {
    table: "tenant.crm_deal_risks",
    search: ["title", "description", "risk_type", "severity", "status"],
    orderBy:
      "CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END, detected_at DESC",
    statusColumn: "status",
    companyScoped: true,
    fields: {
      companyId: "company_id",
      opportunityId: "opportunity_id",
      riskType: "risk_type",
      severity: "severity",
      title: "title",
      description: "description",
      evidence: "evidence",
      detectedAt: "detected_at",
      resolvedAt: "resolved_at",
      resolutionNotes: "resolution_notes",
      status: "status",
    },
  },
  recommendations: {
    table: "tenant.crm_recommendations",
    search: [
      "title",
      "rationale",
      "recommendation_type",
      "entity_type",
      "status",
    ],
    orderBy:
      "CASE priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END, due_at ASC NULLS LAST, created_at DESC",
    statusColumn: "status",
    companyScoped: true,
    fields: {
      companyId: "company_id",
      entityType: "entity_type",
      entityId: "entity_id",
      recommendationType: "recommendation_type",
      title: "title",
      rationale: "rationale",
      actionPayload: "action_payload",
      priority: "priority",
      confidence: "confidence",
      source: "source",
      modelProvider: "model_provider",
      modelName: "model_name",
      dueAt: "due_at",
      status: "status",
      decidedBy: "decided_by",
      decidedAt: "decided_at",
      decisionNotes: "decision_notes",
    },
  },
  "buying-committees": {
    table: "tenant.crm_buying_committees",
    search: ["name", "decision_process", "status"],
    orderBy: "decision_date ASC NULLS LAST, updated_at DESC",
    statusColumn: "status",
    companyScoped: true,
    fields: {
      companyId: "company_id",
      partyId: "party_id",
      opportunityId: "opportunity_id",
      name: "name",
      decisionProcess: "decision_process",
      decisionDate: "decision_date",
      coverageScore: "coverage_score",
      status: "status",
    },
  },
  "buying-committee-members": {
    table: "tenant.crm_buying_committee_members",
    search: ["name", "member_role", "sentiment", "gaps"],
    orderBy:
      "CASE influence_level WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END, name ASC",
    statusColumn: "status",
    companyScoped: true,
    fields: {
      companyId: "company_id",
      committeeId: "committee_id",
      contactId: "contact_id",
      name: "name",
      memberRole: "member_role",
      influenceLevel: "influence_level",
      sentiment: "sentiment",
      engagementScore: "engagement_score",
      authorityConfirmed: "authority_confirmed",
      relationshipOwnerUserId: "relationship_owner_user_id",
      gaps: "gaps",
      status: "status",
    },
  },
  "relationship-edges": {
    table: "tenant.crm_relationship_edges",
    search: [
      "from_entity_type",
      "to_entity_type",
      "relationship_type",
      "notes",
    ],
    orderBy: "strength DESC, updated_at DESC",
    statusColumn: "status",
    companyScoped: true,
    fields: {
      companyId: "company_id",
      fromEntityType: "from_entity_type",
      fromEntityId: "from_entity_id",
      toEntityType: "to_entity_type",
      toEntityId: "to_entity_id",
      relationshipType: "relationship_type",
      strength: "strength",
      source: "source",
      validFrom: "valid_from",
      validTo: "valid_to",
      notes: "notes",
      status: "status",
    },
  },
  "account-signals": {
    table: "tenant.crm_account_signals",
    search: ["title", "description", "signal_type", "source", "status"],
    orderBy: "occurred_at DESC",
    statusColumn: "status",
    companyScoped: true,
    fields: {
      companyId: "company_id",
      partyId: "party_id",
      opportunityId: "opportunity_id",
      signalType: "signal_type",
      title: "title",
      description: "description",
      signalValue: "signal_value",
      score: "score",
      occurredAt: "occurred_at",
      expiresAt: "expires_at",
      source: "source",
      metadata: "metadata",
      status: "status",
    },
  },
  "partner-accounts": {
    table: "tenant.crm_partner_accounts",
    search: ["name", "partner_type", "tier", "region", "status"],
    orderBy: "tier DESC, name ASC",
    statusColumn: "status",
    companyScoped: true,
    fields: {
      companyId: "company_id",
      partyId: "party_id",
      name: "name",
      partnerType: "partner_type",
      tier: "tier",
      region: "region",
      ownerUserId: "owner_user_id",
      agreementStart: "agreement_start",
      agreementEnd: "agreement_end",
      referralPercent: "referral_percent",
      metadata: "metadata",
      status: "status",
    },
  },
  "partner-deals": {
    table: "tenant.crm_partner_deals",
    search: ["deal_registration_code", "partner_owner_name", "notes", "status"],
    orderBy: "registered_at DESC",
    statusColumn: "status",
    companyScoped: true,
    fields: {
      companyId: "company_id",
      partnerAccountId: "partner_account_id",
      opportunityId: "opportunity_id",
      leadId: "lead_id",
      dealRegistrationCode: "deal_registration_code",
      registeredAt: "registered_at",
      expiresAt: "expires_at",
      partnerOwnerName: "partner_owner_name",
      internalOwnerUserId: "internal_owner_user_id",
      expectedValue: "expected_value",
      currencyCode: "currency_code",
      contributionPercent: "contribution_percent",
      notes: "notes",
      status: "status",
    },
  },
  "report-definitions": {
    table: "tenant.crm_report_definitions",
    search: ["name", "resource", "description", "visualization"],
    orderBy: "updated_at DESC, name ASC",
    statusColumn: "status",
    companyScoped: true,
    fields: {
      companyId: "company_id",
      name: "name",
      resource: "resource",
      description: "description",
      dimensions: "dimensions",
      measures: "measures",
      filters: "filters",
      visualization: "visualization",
      isShared: "is_shared",
      ownerUserId: "owner_user_id",
      status: "status",
    },
  },
  dashboards: {
    table: "tenant.crm_dashboards",
    search: ["name", "description", "audience"],
    orderBy: "is_default DESC, updated_at DESC, name ASC",
    statusColumn: "status",
    companyScoped: true,
    fields: {
      companyId: "company_id",
      name: "name",
      description: "description",
      audience: "audience",
      isDefault: "is_default",
      layout: "layout",
      ownerUserId: "owner_user_id",
      status: "status",
    },
  },
  "dashboard-widgets": {
    table: "tenant.crm_dashboard_widgets",
    search: ["title", "widget_type"],
    orderBy: "dashboard_id ASC, sequence ASC",
    statusColumn: "status",
    companyScoped: true,
    fields: {
      companyId: "company_id",
      dashboardId: "dashboard_id",
      reportDefinitionId: "report_definition_id",
      title: "title",
      widgetType: "widget_type",
      position: "position",
      configuration: "configuration",
      sequence: "sequence",
      status: "status",
    },
  },
  "custom-object-definitions": {
    table: "tenant.crm_custom_object_definitions",
    search: ["object_key", "singular_label", "plural_label", "description"],
    orderBy: "plural_label ASC",
    statusColumn: "status",
    companyScoped: false,
    fields: {
      objectKey: "object_key",
      singularLabel: "singular_label",
      pluralLabel: "plural_label",
      description: "description",
      primaryNameField: "primary_name_field",
      companyScoped: "company_scoped",
      status: "status",
    },
  },
  "custom-field-definitions": {
    table: "tenant.crm_custom_field_definitions",
    search: ["field_key", "label", "data_type"],
    orderBy: "object_definition_id ASC, sequence ASC",
    statusColumn: "status",
    companyScoped: false,
    fields: {
      objectDefinitionId: "object_definition_id",
      fieldKey: "field_key",
      label: "label",
      dataType: "data_type",
      required: "required",
      uniqueValue: "unique_value",
      indexed: "indexed",
      options: "options",
      defaultValue: "default_value",
      validation: "validation",
      sequence: "sequence",
      status: "status",
    },
  },
  "custom-records": {
    table: "tenant.crm_custom_records",
    search: ["record_name", "status"],
    orderBy: "updated_at DESC, record_name ASC",
    statusColumn: "status",
    companyScoped: true,
    fields: {
      companyId: "company_id",
      objectDefinitionId: "object_definition_id",
      recordName: "record_name",
      ownerUserId: "owner_user_id",
      data: "data",
      status: "status",
    },
  },
  "field-visits": {
    table: "tenant.crm_field_visits",
    search: ["visit_type", "address", "objective", "outcome", "status"],
    orderBy: "planned_start_at ASC",
    statusColumn: "status",
    companyScoped: true,
    fields: {
      companyId: "company_id",
      partyId: "party_id",
      contactId: "contact_id",
      opportunityId: "opportunity_id",
      ownerUserId: "owner_user_id",
      visitType: "visit_type",
      plannedStartAt: "planned_start_at",
      plannedEndAt: "planned_end_at",
      actualStartAt: "actual_start_at",
      actualEndAt: "actual_end_at",
      latitude: "latitude",
      longitude: "longitude",
      address: "address",
      objective: "objective",
      outcome: "outcome",
      routeSequence: "route_sequence",
      status: "status",
    },
  },
  "enrichment-jobs": {
    table: "tenant.crm_enrichment_jobs",
    search: ["entity_type", "provider", "status", "error_message"],
    orderBy: "requested_at DESC",
    statusColumn: "status",
    companyScoped: true,
    fields: {
      companyId: "company_id",
      entityType: "entity_type",
      entityId: "entity_id",
      provider: "provider",
      requestedFields: "requested_fields",
      resultData: "result_data",
      confidence: "confidence",
      errorMessage: "error_message",
      requestedAt: "requested_at",
      completedAt: "completed_at",
      status: "status",
      requestedBy: "requested_by",
    },
  },
  "ai-predictions": {
    table: "tenant.crm_ai_predictions",
    search: [
      "entity_type",
      "prediction_type",
      "label",
      "model_provider",
      "model_name",
      "status",
    ],
    orderBy: "generated_at DESC",
    statusColumn: "status",
    companyScoped: true,
    fields: {
      companyId: "company_id",
      entityType: "entity_type",
      entityId: "entity_id",
      predictionType: "prediction_type",
      score: "score",
      label: "label",
      explanation: "explanation",
      inputSnapshot: "input_snapshot",
      modelProvider: "model_provider",
      modelName: "model_name",
      modelVersion: "model_version",
      generatedAt: "generated_at",
      expiresAt: "expires_at",
      status: "status",
    },
  },
  "ai-feedback": {
    table: "tenant.crm_ai_feedback",
    search: ["outcome", "feedback"],
    orderBy: "created_at DESC",
    companyScoped: true,
    fields: {
      companyId: "company_id",
      predictionId: "prediction_id",
      recommendationId: "recommendation_id",
      userId: "user_id",
      outcome: "outcome",
      feedback: "feedback",
      correctedValue: "corrected_value",
    },
  },
  "saved-views": {
    table: "tenant.crm_saved_views",
    search: ["name", "resource"],
    orderBy: "resource ASC, is_default DESC, name ASC",
    companyScoped: false,
    fields: {
      userId: "user_id",
      resource: "resource",
      name: "name",
      filters: "filters",
      sort: "sort",
      columns: "columns",
      isDefault: "is_default",
    },
  },
});

function definitionFor(resource) {
  const definition = resources[resource];
  if (!definition) throw new CrmError(404, "Unknown CRM resource.");
  return definition;
}

export function isCrmResource(value) {
  return resourceSet.has(value);
}
function camelize(value) {
  return value.replace(/_([a-z])/g, (_match, character) =>
    character.toUpperCase(),
  );
}
function camelizeRow(row) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [camelize(key), value]),
  );
}
function limitValue(value, fallback = 100, maximum = 500) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(1, Math.min(maximum, Math.trunc(parsed)))
    : fallback;
}
function addParameter(parameters, value) {
  parameters.push(value);
  return `$${parameters.length}`;
}

function recordScope(definition, context, parameters, alias = "record") {
  let sql = "";
  if (definition.table === "tenant.crm_saved_views") {
    sql += ` AND ${alias}.user_id = ${addParameter(parameters, context.userId)}`;
  }
  if (definition.companyScoped && !context.allowAllCompanies) {
    if (!context.activeCompanyId) return " AND false";
    sql += ` AND (${alias}.company_id IS NULL OR ${alias}.company_id = ${addParameter(parameters, context.activeCompanyId)})`;
  }
  if (definition.fields?.branchId && context.activeBranchId) {
    sql += ` AND (${alias}.branch_id IS NULL OR ${alias}.branch_id = ${addParameter(parameters, context.activeBranchId)})`;
  }
  return sql;
}

function assertWritableScope(definition, context, input) {
  if (
    definition.companyScoped &&
    !context.allowAllCompanies &&
    input.companyId &&
    input.companyId !== context.activeCompanyId
  ) {
    throw new CrmError(403, "The CRM record belongs to another company.");
  }
  if (
    definition.fields?.branchId &&
    context.activeBranchId &&
    input.branchId &&
    input.branchId !== context.activeBranchId
  ) {
    throw new CrmError(403, "The CRM record belongs to another branch.");
  }
}

function assertLifecycleUpdate(resource, before, input) {
  if (resource === "consent-events") {
    throw new CrmError(
      409,
      "Consent evidence is immutable. Record a new consent event instead.",
      "CRM_CONSENT_IMMUTABLE",
    );
  }
  if (resource === "forecast-submissions" && input.status !== undefined) {
    const transitions = {
      draft: new Set(["draft", "submitted", "superseded"]),
      submitted: new Set(["submitted", "approved", "rejected", "superseded"]),
      approved: new Set(["approved", "superseded"]),
      rejected: new Set(["rejected", "draft", "superseded"]),
      superseded: new Set(["superseded"]),
    };
    if (!transitions[before.status]?.has(input.status)) {
      throw new CrmError(
        409,
        `Forecast submission cannot move from ${before.status} to ${input.status}.`,
        "CRM_FORECAST_TRANSITION_INVALID",
      );
    }
  }
  if (
    resource === "privacy-requests" &&
    before.status === "completed" &&
    input.status !== undefined &&
    input.status !== "completed"
  ) {
    throw new CrmError(
      409,
      "Completed privacy requests cannot be reopened. Create a new request.",
      "CRM_PRIVACY_REQUEST_CLOSED",
    );
  }
  const controlledFields =
    resource === "opportunities"
      ? ["pipelineId", "stageId", "probability", "forecastCategory", "status"]
      : [];
  for (const field of controlledFields) {
    if (
      input[field] !== undefined &&
      comparable(input[field]) !== comparable(before[field])
    ) {
      throw new CrmError(
        409,
        "Use the governed opportunity stage action for pipeline, stage, probability, forecast category or status changes.",
      );
    }
  }
  if (
    resource === "leads" &&
    input.status === "converted" &&
    before.status !== "converted"
  ) {
    throw new CrmError(409, "Use the governed lead conversion action.");
  }
  if (
    resource === "activities" &&
    input.status === "completed" &&
    before.status !== "completed"
  ) {
    throw new CrmError(409, "Use the governed activity completion action.");
  }
}

async function nextCode(client, organizationId, entityType) {
  const result = await client.query(
    `UPDATE public.numbering_series SET next_number = next_number + 1 WHERE organization_id = $1 AND entity_type = $2 RETURNING prefix, next_number - 1 AS number, padding`,
    [organizationId, entityType],
  );
  if (!result.rows[0])
    throw new CrmError(
      409,
      `Numbering series ${entityType} is not configured.`,
    );
  const row = result.rows[0];
  return `${row.prefix}${String(row.number).padStart(Number(row.padding || 5), "0")}`;
}

function buildSearch(definition, search, parameters, alias = "record") {
  const value = String(search || "").trim();
  if (!value || !definition.search?.length) return "";
  const parameter = addParameter(parameters, `%${value}%`);
  return ` AND (${definition.search.map((column) => `COALESCE(${alias}.${column}::text, '') ILIKE ${parameter}`).join(" OR ")})`;
}

function buildFilters(definition, filters, parameters, alias = "record") {
  let sql = "";
  if (filters.status && filters.status !== "all" && definition.statusColumn)
    sql += ` AND ${alias}.${definition.statusColumn} = ${addParameter(parameters, filters.status)}`;
  for (const [key, column] of [
    ["ownerId", "owner_user_id"],
    ["stageId", "stage_id"],
    ["pipelineId", "pipeline_id"],
    ["sourceId", "source_id"],
    ["campaignId", "campaign_id"],
  ]) {
    if (filters[key] && Object.values(definition.fields).includes(column))
      sql += ` AND ${alias}.${column} = ${addParameter(parameters, filters[key])}`;
  }
  if (definition.table === "tenant.crm_activities") {
    const due = filters.due || "all";
    if (due === "today")
      sql +=
        " AND record.due_at >= current_date AND record.due_at < current_date + interval '1 day'";
    if (due === "overdue")
      sql +=
        " AND record.due_at < now() AND record.status NOT IN ('completed', 'cancelled')";
    if (due === "upcoming")
      sql +=
        " AND record.due_at >= now() AND record.status NOT IN ('completed', 'cancelled')";
  }
  return sql;
}

export async function listCrmRecords(client, context, resource, filters = {}) {
  const definition = definitionFor(resource);
  const parameters = [context.organizationId];
  let where = "record.organization_id = $1";
  where += recordScope(definition, context, parameters);
  where += buildSearch(definition, filters.search, parameters);
  where += buildFilters(definition, filters, parameters);
  const limit = limitValue(filters.limit);
  const offset = Math.max(0, Number(filters.offset || 0) || 0);
  const result = await client.query(
    `SELECT record.*, count(*) OVER()::int AS __total FROM ${definition.table} record WHERE ${where} ORDER BY ${definition.orderBy} LIMIT ${addParameter(parameters, limit)} OFFSET ${addParameter(parameters, offset)}`,
    parameters,
  );
  const total = Number(result.rows[0]?.__total || 0);
  return {
    rows: result.rows.map((row) => {
      const { __total: _ignored, ...record } = row;
      return camelizeRow(record);
    }),
    total,
    limit,
    offset,
  };
}

export async function getCrmRecord(client, context, resource, id) {
  const definition = definitionFor(resource);
  const parameters = [context.organizationId, id];
  const result = await client.query(
    `SELECT record.* FROM ${definition.table} record WHERE record.organization_id = $1 AND record.id = $2${recordScope(definition, context, parameters)} LIMIT 1`,
    parameters,
  );
  if (!result.rows[0]) throw new CrmError(404, "CRM record not found.");
  return camelizeRow(result.rows[0]);
}

function mutableEntries(definition, input) {
  return Object.entries(input).filter(
    ([key, value]) => definition.fields[key] && value !== undefined,
  );
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function valueMatchesCustomField(field, value) {
  if (value === null || value === undefined) return true;
  if (field.data_type === "boolean") return typeof value === "boolean";
  if (["number", "currency"].includes(field.data_type))
    return typeof value === "number" && Number.isFinite(value);
  if (field.data_type === "multi_select") return Array.isArray(value);
  if (field.data_type === "json") return typeof value === "object";
  if (field.data_type === "date")
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (field.data_type === "datetime")
    return typeof value === "string" && Number.isFinite(Date.parse(value));
  if (field.data_type === "email")
    return (
      typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
    );
  if (field.data_type === "url") {
    if (typeof value !== "string") return false;
    try {
      const url = new URL(value);
      return url.protocol === "https:" || url.protocol === "http:";
    } catch {
      return false;
    }
  }
  return typeof value === "string";
}

async function validateCustomRecord(
  client,
  context,
  prepared,
  existingId = null,
) {
  if (!prepared.objectDefinitionId)
    throw new CrmError(400, "Custom object definition is required.");
  if (!isPlainObject(prepared.data))
    throw new CrmError(400, "Custom record data must be a JSON object.");

  const definitionResult = await client.query(
    `SELECT id, company_scoped FROM tenant.crm_custom_object_definitions WHERE organization_id = $1 AND id = $2 AND status = 'active'`,
    [context.organizationId, prepared.objectDefinitionId],
  );
  const objectDefinition = definitionResult.rows[0];
  if (!objectDefinition)
    throw new CrmError(409, "The custom object definition is not active.");
  if (objectDefinition.company_scoped && !prepared.companyId)
    throw new CrmError(400, "A company is required for this custom object.");

  const fieldsResult = await client.query(
    `SELECT field_key, data_type, required, unique_value, options, validation FROM tenant.crm_custom_field_definitions WHERE organization_id = $1 AND object_definition_id = $2 AND status = 'active' ORDER BY sequence, field_key`,
    [context.organizationId, prepared.objectDefinitionId],
  );
  const knownFields = new Set(
    fieldsResult.rows.map((field) => field.field_key),
  );
  const unknownFields = Object.keys(prepared.data).filter(
    (key) => !knownFields.has(key),
  );
  if (unknownFields.length)
    throw new CrmError(
      400,
      `Unknown custom fields: ${unknownFields.join(", ")}.`,
      "CRM_CUSTOM_FIELD_UNKNOWN",
    );

  for (const field of fieldsResult.rows) {
    const value = prepared.data[field.field_key];
    const empty = value === undefined || value === null || value === "";
    if (field.required && empty)
      throw new CrmError(
        400,
        `${field.field_key} is required.`,
        "CRM_CUSTOM_FIELD_REQUIRED",
      );
    if (empty) continue;
    if (!valueMatchesCustomField(field, value))
      throw new CrmError(
        400,
        `${field.field_key} has an invalid ${field.data_type} value.`,
        "CRM_CUSTOM_FIELD_TYPE_INVALID",
      );
    if (
      ["select", "multi_select"].includes(field.data_type) &&
      Array.isArray(field.options) &&
      field.options.length
    ) {
      const selected = Array.isArray(value) ? value : [value];
      if (selected.some((item) => !field.options.includes(item)))
        throw new CrmError(
          400,
          `${field.field_key} contains an unsupported option.`,
          "CRM_CUSTOM_FIELD_OPTION_INVALID",
        );
    }
    const validation = isPlainObject(field.validation) ? field.validation : {};
    if (typeof value === "string" && validation.pattern) {
      let pattern;
      try {
        pattern = new RegExp(String(validation.pattern));
      } catch {
        throw new CrmError(
          409,
          `${field.field_key} has an invalid configured validation pattern.`,
        );
      }
      if (!pattern.test(value))
        throw new CrmError(
          400,
          `${field.field_key} does not match its validation rule.`,
          "CRM_CUSTOM_FIELD_PATTERN_INVALID",
        );
    }
    if (typeof value === "number") {
      if (
        validation.minimum !== undefined &&
        value < Number(validation.minimum)
      )
        throw new CrmError(400, `${field.field_key} is below its minimum.`);
      if (
        validation.maximum !== undefined &&
        value > Number(validation.maximum)
      )
        throw new CrmError(400, `${field.field_key} exceeds its maximum.`);
    }
    if (field.unique_value) {
      const uniqueParameters = [
        context.organizationId,
        prepared.objectDefinitionId,
        field.field_key,
        JSON.stringify(value),
      ];
      let exclusion = "";
      if (existingId) {
        uniqueParameters.push(existingId);
        exclusion = " AND id <> $5";
      }
      const duplicate = await client.query(
        `SELECT 1 FROM tenant.crm_custom_records WHERE organization_id = $1 AND object_definition_id = $2 AND data -> $3 = $4::jsonb${exclusion} LIMIT 1`,
        uniqueParameters,
      );
      if (duplicate.rows[0])
        throw new CrmError(
          409,
          `${field.field_key} must be unique.`,
          "CRM_CUSTOM_FIELD_NOT_UNIQUE",
        );
    }
  }
}

export async function createCrmRecord(client, context, resource, input) {
  const definition = definitionFor(resource);
  assertWritableScope(definition, context, input);
  const prepared = { ...input };
  if (resource === "saved-views") prepared.userId = context.userId;
  if (definition.codeEntity && !prepared[definition.codeField])
    prepared[definition.codeField] = await nextCode(
      client,
      context.organizationId,
      definition.codeEntity,
    );
  if (
    definition.companyScoped &&
    !prepared.companyId &&
    context.activeCompanyId
  )
    prepared.companyId = context.activeCompanyId;
  if (
    definition.companyScoped &&
    !prepared.branchId &&
    context.activeBranchId &&
    definition.fields.branchId
  )
    prepared.branchId = context.activeBranchId;
  if (resource === "leads" && !prepared.ownerUserId)
    prepared.ownerUserId = await resolveLeadOwner(client, context, prepared);
  if (
    resource === "opportunities" &&
    (!prepared.pipelineId || !prepared.stageId)
  ) {
    const pipeline = await client.query(
      `SELECT p.id, s.id AS stage_id, s.probability, s.forecast_category FROM tenant.crm_pipelines p JOIN tenant.crm_pipeline_stages s ON s.pipeline_id = p.id AND s.status = 'active' WHERE p.organization_id = $1 AND p.status = 'active' ORDER BY p.is_default DESC, s.sequence ASC LIMIT 1`,
      [context.organizationId],
    );
    if (!pipeline.rows[0])
      throw new CrmError(
        409,
        "Configure an active CRM pipeline before creating opportunities.",
      );
    prepared.pipelineId ||= pipeline.rows[0].id;
    prepared.stageId ||= pipeline.rows[0].stage_id;
    prepared.probability ??= pipeline.rows[0].probability;
    prepared.forecastCategory ??= pipeline.rows[0].forecast_category;
  }
  if (resource === "leads")
    prepared.score = await calculateLeadScore(
      client,
      context.organizationId,
      prepared,
    );
  if (resource === "custom-records")
    await validateCustomRecord(client, context, prepared);
  const entries = mutableEntries(definition, prepared);
  if (!entries.length) throw new CrmError(400, "No CRM fields were supplied.");
  const columns = [
    "organization_id",
    ...entries.map(([key]) => definition.fields[key]),
    "created_by",
    "updated_by",
  ];
  const values = [
    context.organizationId,
    ...entries.map(([, value]) => value),
    context.userId,
    context.userId,
  ];
  const result = await client.query(
    `INSERT INTO ${definition.table} (${columns.join(", ")}) VALUES (${values.map((_value, index) => `$${index + 1}`).join(", ")}) RETURNING *`,
    values,
  );
  const created = camelizeRow(result.rows[0]);
  if (resource === "leads") {
    await recordLeadScore(
      client,
      context,
      created.id,
      0,
      Number(created.score || 0),
      "Initial lead scoring",
    );
    await runCrmAutomation(
      client,
      context,
      "lead.created",
      "lead",
      created.id,
      created,
    );
  }
  if (resource === "opportunities") {
    await client.query(
      `INSERT INTO tenant.crm_opportunity_stage_history (organization_id, opportunity_id, to_stage_id, probability, changed_by, note) VALUES ($1, $2, $3, $4, $5, 'Opportunity created')`,
      [
        context.organizationId,
        created.id,
        created.stageId,
        created.probability,
        context.userId,
      ],
    );
    await runCrmAutomation(
      client,
      context,
      "opportunity.created",
      "opportunity",
      created.id,
      created,
    );
  }
  await queueOutboxEvent(
    client,
    context,
    `crm.${resource}.created`,
    resource,
    created.id,
    created,
  );
  return created;
}

export async function updateCrmRecord(client, context, resource, id, input) {
  const definition = definitionFor(resource);
  const before = await getCrmRecord(client, context, resource, id);
  assertWritableScope(definition, context, input);
  if (resource === "saved-views") delete input.userId;
  assertLifecycleUpdate(resource, before, input);
  const prepared = { ...input };
  if (resource === "leads")
    prepared.score = await calculateLeadScore(client, context.organizationId, {
      ...before,
      ...prepared,
    });
  if (resource === "custom-records") {
    prepared.objectDefinitionId ??= before.objectDefinitionId;
    prepared.companyId ??= before.companyId;
    prepared.data ??= before.data;
    await validateCustomRecord(client, context, prepared, id);
  }
  const entries = mutableEntries(definition, prepared);
  if (!entries.length) throw new CrmError(400, "No CRM fields were supplied.");
  const parameters = entries.map(([, value]) => value);
  const assignments = entries.map(
    ([key], index) => `${definition.fields[key]} = $${index + 1}`,
  );
  parameters.push(context.userId, context.organizationId, id);
  const userParameter = entries.length + 1;
  const organizationParameter = entries.length + 2;
  const idParameter = entries.length + 3;
  const scope = recordScope(definition, context, parameters);
  const result = await client.query(
    `UPDATE ${definition.table} record SET ${assignments.join(", ")}, updated_by = $${userParameter}, updated_at = now() WHERE record.organization_id = $${organizationParameter} AND record.id = $${idParameter}${scope} RETURNING record.*`,
    parameters,
  );
  if (!result.rows[0]) throw new CrmError(404, "CRM record not found.");
  const updated = camelizeRow(result.rows[0]);
  if (
    resource === "leads" &&
    Number(before.score || 0) !== Number(updated.score || 0)
  )
    await recordLeadScore(
      client,
      context,
      id,
      Number(before.score || 0),
      Number(updated.score || 0),
      "Lead fields updated",
    );
  await queueOutboxEvent(
    client,
    context,
    `crm.${resource}.updated`,
    resource,
    id,
    { before, after: updated },
  );
  return updated;
}

export async function archiveCrmRecord(client, context, resource, id) {
  const definition = definitionFor(resource);
  const before = await getCrmRecord(client, context, resource, id);
  const parameters = [context.organizationId, id];
  const scope = recordScope(definition, context, parameters);

  if (
    resource === "consent-events" ||
    resource === "communications" ||
    resource === "playbook-responses" ||
    resource === "data-quality-scores" ||
    resource === "pipeline-inspections" ||
    resource === "ai-feedback"
  ) {
    throw new CrmError(
      409,
      "This CRM record is immutable and cannot be deleted.",
      "CRM_RECORD_IMMUTABLE",
    );
  }
  if (resource === "privacy-requests" && before.status === "completed") {
    throw new CrmError(
      409,
      "Completed privacy requests cannot be archived.",
      "CRM_PRIVACY_REQUEST_CLOSED",
    );
  }

  if (resource === "saved-views") {
    const result = await client.query(
      `DELETE FROM ${definition.table} record WHERE record.organization_id = $1 AND record.id = $2${scope} RETURNING record.id`,
      parameters,
    );
    if (!result.rows[0]) throw new CrmError(404, "CRM record not found.");
    return { id, deleted: true };
  }

  const archiveStatuses = {
    leads: "archived",
    opportunities: "archived",
    activities: "cancelled",
    campaigns: "cancelled",
    pipelines: "inactive",
    stages: "inactive",
    sources: "inactive",
    "lost-reasons": "inactive",
    tags: "inactive",
    "scoring-rules": "inactive",
    "assignment-rules": "inactive",
    sequences: "archived",
    "sequence-enrollments": "cancelled",
    "automation-rules": "inactive",
    "capture-forms": "inactive",
    competitors: "inactive",
    integrations: "disabled",
    "webhook-subscriptions": "inactive",
    "sales-teams": "inactive",
    "sales-team-members": "inactive",
    territories: "archived",
    "quota-plans": "cancelled",
    "forecast-periods": "closed",
    "forecast-submissions": "superseded",
    "account-plans": "archived",
    "account-stakeholders": "inactive",
    playbooks: "archived",
    "playbook-questions": "inactive",
    "privacy-requests": "cancelled",
    "engagement-templates": "archived",
    "meeting-links": "archived",
    "sync-accounts": "disabled",
    conversations: "archived",
    "conversation-insights": "superseded",
    "deal-risks": "dismissed",
    recommendations: "expired",
    "buying-committees": "archived",
    "buying-committee-members": "inactive",
    "relationship-edges": "inactive",
    "account-signals": "dismissed",
    "partner-accounts": "archived",
    "partner-deals": "cancelled",
    "report-definitions": "archived",
    dashboards: "archived",
    "dashboard-widgets": "inactive",
    "custom-object-definitions": "archived",
    "custom-field-definitions": "archived",
    "custom-records": "archived",
    "field-visits": "cancelled",
    "enrichment-jobs": "cancelled",
    "ai-predictions": "expired",
  };
  const status = archiveStatuses[resource];
  if (!definition.statusColumn || !status) {
    throw new CrmError(
      409,
      "This CRM resource has no supported archive transition.",
      "CRM_ARCHIVE_UNSUPPORTED",
    );
  }

  const statusParameter = addParameter(parameters, status);
  const userParameter = addParameter(parameters, context.userId);
  const result = await client.query(
    `UPDATE ${definition.table} record SET ${definition.statusColumn} = ${statusParameter}, updated_by = ${userParameter}, updated_at = now() WHERE record.organization_id = $1 AND record.id = $2${scope} RETURNING record.*`,
    parameters,
  );
  if (!result.rows[0]) throw new CrmError(404, "CRM record not found.");
  const record = camelizeRow(result.rows[0]);
  await queueOutboxEvent(
    client,
    context,
    `crm.${resource}.archived`,
    resource,
    id,
    record,
  );
  return record;
}

function comparable(value) {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value.trim().toLowerCase() : value;
}
function ruleMatches(record, rule) {
  const value = record[camelize(rule.field_name)];
  const expected = rule.comparison_value?.value ?? rule.comparison_value;
  switch (rule.operator) {
    case "equals":
      return comparable(value) === comparable(expected);
    case "not_equals":
      return comparable(value) !== comparable(expected);
    case "contains":
      return String(value || "")
        .toLowerCase()
        .includes(String(expected || "").toLowerCase());
    case "not_empty":
      return (
        value !== null && value !== undefined && String(value).trim() !== ""
      );
    case "empty":
      return (
        value === null || value === undefined || String(value).trim() === ""
      );
    case "greater_than":
      return Number(value) > Number(expected);
    case "less_than":
      return Number(value) < Number(expected);
    case "in":
      return (
        Array.isArray(expected) &&
        expected.map(comparable).includes(comparable(value))
      );
    default:
      return false;
  }
}

export async function calculateLeadScore(client, organizationId, lead) {
  const rules = await client.query(
    `SELECT field_name, operator, comparison_value, points FROM tenant.crm_scoring_rules WHERE organization_id = $1 AND status = 'active' ORDER BY sequence, name`,
    [organizationId],
  );
  return rules.rows.reduce(
    (score, rule) =>
      score + (ruleMatches(lead, rule) ? Number(rule.points || 0) : 0),
    0,
  );
}
async function recordLeadScore(
  client,
  context,
  leadId,
  previousScore,
  newScore,
  reason,
  ruleId = null,
) {
  await client.query(
    `INSERT INTO tenant.crm_lead_score_history (organization_id, lead_id, previous_score, new_score, reason, rule_id, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      context.organizationId,
      leadId,
      previousScore,
      newScore,
      reason,
      ruleId,
      context.userId,
    ],
  );
}
function criteriaMatches(input, criteria) {
  if (!criteria || typeof criteria !== "object") return true;
  return Object.entries(criteria).every(([key, expected]) =>
    Array.isArray(expected)
      ? expected.map(comparable).includes(comparable(input[key]))
      : comparable(input[key]) === comparable(expected),
  );
}

export async function resolveLeadOwner(client, context, input) {
  const result = await client.query(
    `SELECT * FROM tenant.crm_assignment_rules WHERE organization_id = $1 AND status = 'active' ORDER BY sequence, name`,
    [context.organizationId],
  );
  const rule = result.rows.find((candidate) =>
    criteriaMatches(input, candidate.criteria),
  );
  if (!rule) return context.userId;
  if (rule.assignment_mode === "fixed")
    return rule.assignee_user_id || context.userId;
  const users = rule.round_robin_user_ids || [];
  if (!users.length) return context.userId;
  const state = await client.query(
    `INSERT INTO tenant.crm_round_robin_state (organization_id, assignment_rule_id, next_index) VALUES ($1, $2, 1) ON CONFLICT (organization_id, assignment_rule_id) DO UPDATE SET next_index = tenant.crm_round_robin_state.next_index + 1, updated_at = now() RETURNING next_index`,
    [context.organizationId, rule.id],
  );
  return users[
    Math.max(0, Number(state.rows[0]?.next_index || 1) - 1) % users.length
  ];
}

export async function convertCrmLead(client, context, leadId, input = {}) {
  const leadParameters = [context.organizationId, leadId];
  const leadResult = await client.query(
    `SELECT record.* FROM tenant.crm_leads record WHERE record.organization_id = $1 AND record.id = $2${recordScope(resources.leads, context, leadParameters)} FOR UPDATE`,
    leadParameters,
  );
  const lead = leadResult.rows[0];
  if (!lead) throw new CrmError(404, "Lead not found.");
  const existing = await client.query(
    `SELECT * FROM tenant.crm_conversion_records WHERE organization_id = $1 AND lead_id = $2 LIMIT 1`,
    [context.organizationId, leadId],
  );
  if (existing.rows[0])
    return { ...camelizeRow(existing.rows[0]), replayed: true };
  if (lead.status === "archived")
    throw new CrmError(409, "Archived leads cannot be converted.");
  let partyId = input.partyId || null;
  if (!partyId) {
    const duplicate = await client.query(
      `SELECT p.id FROM tenant.business_parties p LEFT JOIN tenant.contacts c ON c.party_id = p.id AND c.organization_id = p.organization_id WHERE p.organization_id = $1 AND (lower(p.display_name) = lower($2) OR ($3::text IS NOT NULL AND tenant.crm_normalize_email(c.email) = tenant.crm_normalize_email($3))) ORDER BY p.created_at LIMIT 1`,
      [
        context.organizationId,
        lead.company_name || lead.full_name,
        lead.email || null,
      ],
    );
    partyId = duplicate.rows[0]?.id || null;
  }
  if (!partyId) {
    const partyCode = await nextCode(
      client,
      context.organizationId,
      "business_party",
    );
    const party = await client.query(
      `INSERT INTO tenant.business_parties (organization_id, company_id, code, party_type, display_name, legal_name, currency_code, created_by, updated_by) VALUES ($1, $2, $3, 'customer', $4, $5, $6, $7, $7) RETURNING id`,
      [
        context.organizationId,
        lead.company_id,
        partyCode,
        lead.company_name || lead.full_name,
        lead.company_name || null,
        lead.currency_code || null,
        context.userId,
      ],
    );
    partyId = party.rows[0].id;
  }
  let contactId = input.contactId || null;
  if (!contactId && (lead.email || lead.mobile || lead.phone)) {
    const contact = await client.query(
      `SELECT id FROM tenant.contacts WHERE organization_id = $1 AND party_id = $2 AND (($3::text IS NOT NULL AND tenant.crm_normalize_email(email) = tenant.crm_normalize_email($3)) OR ($4::text IS NOT NULL AND tenant.crm_normalize_phone(COALESCE(mobile, phone)) = tenant.crm_normalize_phone($4))) ORDER BY is_primary DESC, created_at LIMIT 1`,
      [
        context.organizationId,
        partyId,
        lead.email || null,
        lead.mobile || lead.phone || null,
      ],
    );
    contactId = contact.rows[0]?.id || null;
  }
  if (!contactId) {
    const contact = await client.query(
      `INSERT INTO tenant.contacts (organization_id, party_id, first_name, last_name, designation, email, phone, mobile, is_primary, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOT EXISTS (SELECT 1 FROM tenant.contacts WHERE organization_id = $1 AND party_id = $2 AND is_primary = true AND status = 'active'), $9, $9) RETURNING id`,
      [
        context.organizationId,
        partyId,
        lead.first_name,
        lead.last_name,
        lead.job_title,
        lead.email,
        lead.phone,
        lead.mobile,
        context.userId,
      ],
    );
    contactId = contact.rows[0].id;
  }
  let opportunityId = null;
  if (input.createOpportunity !== false) {
    const opportunity = await createCrmRecord(
      client,
      context,
      "opportunities",
      {
        companyId: lead.company_id,
        branchId: lead.branch_id,
        leadId,
        partyId,
        contactId,
        campaignId: lead.campaign_id,
        sourceId: lead.source_id,
        ownerUserId: lead.owner_user_id || context.userId,
        name:
          input.opportunityName ||
          `${lead.company_name || lead.full_name} opportunity`,
        amount: input.amount ?? lead.estimated_value ?? 0,
        currencyCode: input.currencyCode || lead.currency_code,
        expectedCloseDate: input.expectedCloseDate || null,
        nextStep:
          input.nextStep || "Complete discovery and confirm requirements",
      },
    );
    opportunityId = opportunity.id;
  }
  await client.query(
    `UPDATE tenant.crm_leads SET status = 'converted', converted_at = now(), converted_party_id = $1, converted_contact_id = $2, converted_opportunity_id = $3, updated_by = $4, updated_at = now() WHERE organization_id = $5 AND id = $6`,
    [
      partyId,
      contactId,
      opportunityId,
      context.userId,
      context.organizationId,
      leadId,
    ],
  );
  const conversion = await client.query(
    `INSERT INTO tenant.crm_conversion_records (organization_id, lead_id, party_id, contact_id, opportunity_id, converted_by, input_snapshot) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [
      context.organizationId,
      leadId,
      partyId,
      contactId,
      opportunityId,
      context.userId,
      input,
    ],
  );
  await client.query(
    `UPDATE tenant.crm_campaign_members SET member_status = 'converted', converted_at = now() WHERE organization_id = $1 AND lead_id = $2`,
    [context.organizationId, leadId],
  );
  await queueOutboxEvent(
    client,
    context,
    "crm.lead.converted",
    "lead",
    leadId,
    { partyId, contactId, opportunityId },
  );
  return { ...camelizeRow(conversion.rows[0]), replayed: false };
}

export async function mergeCrmLead(client, context, sourceId, targetId) {
  if (sourceId === targetId)
    throw new CrmError(400, "A lead cannot be merged into itself.");
  const parameters = [context.organizationId, [sourceId, targetId]];
  const rows = await client.query(
    `SELECT record.* FROM tenant.crm_leads record WHERE record.organization_id = $1 AND record.id = ANY($2::uuid[])${recordScope(resources.leads, context, parameters)} FOR UPDATE`,
    parameters,
  );
  const source = rows.rows.find((row) => row.id === sourceId);
  const target = rows.rows.find((row) => row.id === targetId);
  if (!source || !target)
    throw new CrmError(404, "Source or target lead was not found.");
  if (source.status === "converted")
    throw new CrmError(409, "Converted leads cannot be merged.");
  await client.query(
    `INSERT INTO tenant.crm_lead_tags (organization_id, lead_id, tag_id, created_by) SELECT organization_id, $3, tag_id, $4 FROM tenant.crm_lead_tags WHERE organization_id = $1 AND lead_id = $2 ON CONFLICT DO NOTHING`,
    [context.organizationId, sourceId, targetId, context.userId],
  );
  await client.query(
    `UPDATE tenant.crm_activities SET entity_id = $1, updated_by = $2, updated_at = now() WHERE organization_id = $3 AND entity_type = 'lead' AND entity_id = $4`,
    [targetId, context.userId, context.organizationId, sourceId],
  );
  await client.query(
    `UPDATE tenant.crm_communications SET lead_id = $1 WHERE organization_id = $2 AND lead_id = $3`,
    [targetId, context.organizationId, sourceId],
  );
  await client.query(
    `INSERT INTO tenant.crm_campaign_members (organization_id, campaign_id, lead_id, member_status, responded_at, converted_at, created_by) SELECT organization_id, campaign_id, $1, member_status, responded_at, converted_at, $2 FROM tenant.crm_campaign_members WHERE organization_id = $3 AND lead_id = $4 ON CONFLICT DO NOTHING`,
    [targetId, context.userId, context.organizationId, sourceId],
  );
  await client.query(
    `DELETE FROM tenant.crm_campaign_members WHERE organization_id = $1 AND lead_id = $2`,
    [context.organizationId, sourceId],
  );
  await client.query(
    `UPDATE tenant.crm_leads SET status = 'archived', unqualified_reason = $1, updated_by = $2, updated_at = now() WHERE organization_id = $3 AND id = $4`,
    [
      `Merged into ${targetId}`,
      context.userId,
      context.organizationId,
      sourceId,
    ],
  );
  const result = await client.query(
    `INSERT INTO tenant.crm_merge_records (organization_id, entity_type, source_id, target_id, merged_by, snapshot) VALUES ($1, 'lead', $2, $3, $4, $5) RETURNING *`,
    [
      context.organizationId,
      sourceId,
      targetId,
      context.userId,
      { source, target },
    ],
  );
  await queueOutboxEvent(client, context, "crm.lead.merged", "lead", targetId, {
    sourceId,
    targetId,
  });
  return camelizeRow(result.rows[0]);
}

export async function moveOpportunityStage(
  client,
  context,
  opportunityId,
  stageId,
  note = null,
) {
  const opportunityParameters = [context.organizationId, opportunityId];
  const opportunityResult = await client.query(
    `SELECT record.* FROM tenant.crm_opportunities record WHERE record.organization_id = $1 AND record.id = $2${recordScope(resources.opportunities, context, opportunityParameters)} FOR UPDATE`,
    opportunityParameters,
  );
  const opportunity = opportunityResult.rows[0];
  if (!opportunity) throw new CrmError(404, "Opportunity not found.");
  const stageResult = await client.query(
    `SELECT * FROM tenant.crm_pipeline_stages WHERE organization_id = $1 AND id = $2 AND pipeline_id = $3 AND status = 'active'`,
    [context.organizationId, stageId, opportunity.pipeline_id],
  );
  const stage = stageResult.rows[0];
  if (!stage)
    throw new CrmError(
      409,
      "The selected stage is not part of this opportunity pipeline.",
    );
  const requiredPlaybookResponses = await client.query(
    `SELECT question.id, question.prompt
       FROM tenant.crm_playbook_questions question
       JOIN tenant.crm_playbooks playbook
         ON playbook.id = question.playbook_id
        AND playbook.organization_id = question.organization_id
       LEFT JOIN tenant.crm_playbook_responses response
         ON response.question_id = question.id
        AND response.organization_id = question.organization_id
        AND response.opportunity_id = $2
      WHERE question.organization_id = $1
        AND playbook.pipeline_id = $3
        AND playbook.status = 'active'
        AND question.status = 'active'
        AND question.required = true
        AND question.blocks_stage_exit = true
        AND (question.stage_id IS NULL OR question.stage_id = $4)
        AND response.id IS NULL
      ORDER BY question.sequence, question.prompt`,
    [
      context.organizationId,
      opportunityId,
      opportunity.pipeline_id,
      opportunity.stage_id,
    ],
  );
  if (requiredPlaybookResponses.rows.length) {
    throw new CrmError(
      409,
      `Complete required playbook questions before changing stage: ${requiredPlaybookResponses.rows
        .map((row) => row.prompt)
        .join("; ")}`,
      "CRM_PLAYBOOK_INCOMPLETE",
    );
  }
  const status = stage.is_won ? "won" : stage.is_lost ? "lost" : "open";
  const result = await client.query(
    `UPDATE tenant.crm_opportunities SET stage_id = $1, probability = $2, forecast_category = $3, status = $4, actual_close_date = CASE WHEN $4 IN ('won','lost') THEN current_date ELSE NULL END, updated_by = $5, updated_at = now() WHERE organization_id = $6 AND id = $7 RETURNING *`,
    [
      stageId,
      stage.probability,
      stage.forecast_category,
      status,
      context.userId,
      context.organizationId,
      opportunityId,
    ],
  );
  await client.query(
    `INSERT INTO tenant.crm_opportunity_stage_history (organization_id, opportunity_id, from_stage_id, to_stage_id, probability, changed_by, note) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      context.organizationId,
      opportunityId,
      opportunity.stage_id,
      stageId,
      stage.probability,
      context.userId,
      note,
    ],
  );
  const updated = camelizeRow(result.rows[0]);
  await runCrmAutomation(
    client,
    context,
    "opportunity.stage_changed",
    "opportunity",
    opportunityId,
    updated,
  );
  await queueOutboxEvent(
    client,
    context,
    "crm.opportunity.stage_changed",
    "opportunity",
    opportunityId,
    { fromStageId: opportunity.stage_id, toStageId: stageId, status },
  );
  return updated;
}

export async function completeCrmActivity(
  client,
  context,
  activityId,
  outcome = null,
) {
  const parameters = [
    outcome,
    context.userId,
    context.organizationId,
    activityId,
  ];
  const result = await client.query(
    `UPDATE tenant.crm_activities record SET status = 'completed', completed_at = now(), outcome = COALESCE($1, outcome), updated_by = $2, updated_at = now() WHERE record.organization_id = $3 AND record.id = $4${recordScope(resources.activities, context, parameters)} RETURNING record.*`,
    parameters,
  );
  if (!result.rows[0]) throw new CrmError(404, "Activity not found.");
  const activity = camelizeRow(result.rows[0]);
  if (activity.entityType === "lead" && activity.entityId)
    await client.query(
      `UPDATE tenant.crm_leads SET last_contacted_at = now(), first_responded_at = COALESCE(first_responded_at, now()), updated_at = now() WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, activity.entityId],
    );
  if (activity.entityType === "opportunity" && activity.entityId)
    await client.query(
      `UPDATE tenant.crm_opportunities SET last_activity_at = now(), updated_at = now() WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, activity.entityId],
    );
  await queueOutboxEvent(
    client,
    context,
    "crm.activity.completed",
    "activity",
    activityId,
    activity,
  );
  return activity;
}

export async function runCrmAutomation(
  client,
  context,
  eventType,
  entityType,
  entityId,
  payload,
) {
  const rules = await client.query(
    `SELECT * FROM tenant.crm_automation_rules WHERE organization_id = $1 AND event_type = $2 AND status = 'active' ORDER BY sequence, name`,
    [context.organizationId, eventType],
  );
  const results = [];
  for (const rule of rules.rows) {
    if (!criteriaMatches(payload, rule.conditions)) {
      results.push({ ruleId: rule.id, status: "skipped" });
      continue;
    }
    const output = [];
    await client.query("SAVEPOINT crm_automation_rule");
    try {
      for (const action of Array.isArray(rule.actions) ? rule.actions : []) {
        if (action.type === "create_activity") {
          const created = await createCrmRecord(client, context, "activities", {
            entityType,
            entityId,
            activityType: action.activityType || "task",
            subject:
              action.subject ||
              `Follow up: ${payload.name || payload.fullName || entityType}`,
            description: action.description || null,
            assignedTo:
              action.assignedTo || payload.ownerUserId || context.userId,
            dueAt: new Date(
              Date.now() + Number(action.delayMinutes || 0) * 60000,
            ).toISOString(),
          });
          output.push({ action: action.type, id: created.id });
        }
        if (action.type === "notification" && action.userId) {
          await client.query(
            `INSERT INTO public.notifications (organization_id, user_id, type, title, message, href) VALUES ($1, $2, 'crm_automation', $3, $4, $5)`,
            [
              context.organizationId,
              action.userId,
              action.title || "CRM automation",
              action.message || "A CRM automation rule ran.",
              action.href || `/crm/${entityType}s/${entityId}`,
            ],
          );
          output.push({ action: action.type });
        }
        if (action.type === "update_record" && isPlainObject(action.fields)) {
          const targetResource =
            entityType === "lead"
              ? "leads"
              : entityType === "opportunity"
                ? "opportunities"
                : entityType === "activity"
                  ? "activities"
                  : null;
          if (!targetResource)
            throw new CrmError(
              400,
              `Automation cannot update ${entityType} records.`,
            );
          await updateCrmRecord(
            client,
            context,
            targetResource,
            entityId,
            action.fields,
          );
          output.push({ action: action.type, resource: targetResource });
        }
        if (action.type === "assign_owner" && action.userId) {
          const targetResource =
            entityType === "lead"
              ? "leads"
              : entityType === "opportunity"
                ? "opportunities"
                : entityType === "activity"
                  ? "activities"
                  : null;
          const ownerField =
            targetResource === "activities" ? "assignedTo" : "ownerUserId";
          if (!targetResource)
            throw new CrmError(
              400,
              `Automation cannot assign ${entityType} records.`,
            );
          const membership = await client.query(
            `SELECT 1 FROM public.organization_memberships WHERE organization_id = $1 AND user_id = $2 AND status = 'active'`,
            [context.organizationId, action.userId],
          );
          if (!membership.rows[0])
            throw new CrmError(
              409,
              "Automation owner must be an active organization member.",
            );
          await updateCrmRecord(client, context, targetResource, entityId, {
            [ownerField]: action.userId,
          });
          output.push({ action: action.type, userId: action.userId });
        }
        if (action.type === "enroll_sequence" && action.sequenceId) {
          const targetField =
            entityType === "lead"
              ? "leadId"
              : entityType === "opportunity"
                ? "opportunityId"
                : entityType === "contact"
                  ? "contactId"
                  : null;
          if (!targetField)
            throw new CrmError(
              400,
              `Automation cannot enroll ${entityType} in a sequence.`,
            );
          const enrollment = await createCrmRecord(
            client,
            context,
            "sequence-enrollments",
            {
              sequenceId: action.sequenceId,
              [targetField]: entityId,
              currentStep: 0,
              nextRunAt: new Date(
                Date.now() + Number(action.delayMinutes || 0) * 60000,
              ).toISOString(),
              status: "active",
              enrolledBy: context.userId,
            },
          );
          output.push({ action: action.type, id: enrollment.id });
        }
        if (action.type === "create_recommendation" && action.title) {
          const recommendation = await createCrmRecord(
            client,
            context,
            "recommendations",
            {
              companyId: payload.companyId || context.activeCompanyId,
              entityType,
              entityId,
              recommendationType:
                action.recommendationType || "next_best_action",
              title: action.title,
              rationale:
                action.rationale || "Created by a governed CRM automation.",
              actionPayload: action.actionPayload || {},
              priority: action.priority || "medium",
              confidence: action.confidence ?? null,
              source: "rules",
              dueAt: action.dueAt || null,
              status: "open",
            },
          );
          output.push({ action: action.type, id: recommendation.id });
        }
        if (action.type === "queue_communication") {
          const targetField =
            entityType === "lead"
              ? "leadId"
              : entityType === "opportunity"
                ? "opportunityId"
                : entityType === "contact"
                  ? "contactId"
                  : entityType === "party"
                    ? "partyId"
                    : null;
          if (!targetField)
            throw new CrmError(
              400,
              `Automation cannot communicate with ${entityType}.`,
            );
          const communication = await createCrmRecord(
            client,
            context,
            "communications",
            {
              channel: action.channel || "email",
              direction: "outbound",
              [targetField]: entityId,
              provider: action.provider || "outbox",
              subject: action.subject || null,
              body: action.body || "",
              fromAddress: action.fromAddress || null,
              toAddresses: Array.isArray(action.toAddresses)
                ? action.toAddresses
                : [],
              status: "queued",
              occurredAt: new Date().toISOString(),
              metadata: { automationRuleId: rule.id },
            },
          );
          output.push({ action: action.type, id: communication.id });
        }
        if (action.type === "emit_event" && action.eventType) {
          await queueOutboxEvent(
            client,
            context,
            action.eventType,
            entityType,
            entityId,
            isPlainObject(action.payload) ? action.payload : payload,
          );
          output.push({ action: action.type, eventType: action.eventType });
        }
      }
      await client.query(
        `INSERT INTO tenant.crm_automation_runs (organization_id, rule_id, event_type, entity_type, entity_id, status, result, finished_at) VALUES ($1, $2, $3, $4, $5, 'succeeded', $6, now())`,
        [
          context.organizationId,
          rule.id,
          eventType,
          entityType,
          entityId,
          output,
        ],
      );
      await client.query("RELEASE SAVEPOINT crm_automation_rule");
      results.push({ ruleId: rule.id, status: "succeeded", output });
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT crm_automation_rule");
      await client.query("RELEASE SAVEPOINT crm_automation_rule");
      await client.query(
        `INSERT INTO tenant.crm_automation_runs (organization_id, rule_id, event_type, entity_type, entity_id, status, error_message, finished_at) VALUES ($1, $2, $3, $4, $5, 'failed', $6, now())`,
        [
          context.organizationId,
          rule.id,
          eventType,
          entityType,
          entityId,
          String(error?.message || error),
        ],
      );
      results.push({ ruleId: rule.id, status: "failed" });
    }
  }
  return results;
}

export async function queueOutboxEvent(
  client,
  context,
  eventType,
  entityType,
  entityId,
  payload,
) {
  await client.query(
    `INSERT INTO tenant.crm_outbox_events (organization_id, event_type, entity_type, entity_id, payload) VALUES ($1, $2, $3, $4, $5)`,
    [context.organizationId, eventType, entityType, entityId, payload || {}],
  );
}

export async function getCrmOptions(client, context) {
  const parameters = [
    context.organizationId,
    context.activeCompanyId,
    context.activeBranchId,
    Boolean(context.allowAllCompanies),
  ];
  const companyVisible = (alias, includeUnassigned = true) =>
    `($4::boolean OR ($2::uuid IS NOT NULL AND ${includeUnassigned ? `(${alias}.company_id IS NULL OR ${alias}.company_id = $2)` : `${alias}.company_id = $2`}))`;
  const branchVisible = (alias) =>
    `($3::uuid IS NULL OR ${alias}.branch_id IS NULL OR ${alias}.branch_id = $3)`;

  const queryOptions = (sql, values) =>
    client.query(
      `WITH crm_scope_parameters AS (
        SELECT $1::uuid AS organization_id,
          $2::uuid AS active_company_id,
          $3::uuid AS active_branch_id,
          $4::boolean AS allow_all_companies
      )
      ${sql}`,
      values,
    );
  const companies = await queryOptions(
    `SELECT company.id, company.name FROM public.companies company WHERE company.organization_id = $1 AND company.status = 'active' AND ($4::boolean OR company.id = $2) ORDER BY company.is_primary DESC, company.name`,
    parameters,
  );
  const branches = await queryOptions(
    `SELECT branch.id, branch.name, branch.company_id FROM public.branches branch WHERE branch.organization_id = $1 AND branch.status = 'active' AND ${companyVisible("branch", false)} AND ($3::uuid IS NULL OR branch.id = $3) ORDER BY branch.is_primary DESC, branch.name`,
    parameters,
  );
  const currencies = await queryOptions(
    `SELECT code AS id, code AS name FROM tenant.currencies WHERE organization_id = $1 AND status = 'active' ORDER BY is_base DESC, code`,
    parameters,
  );
  const pipelines = await queryOptions(
    `SELECT pipeline.id, pipeline.name, pipeline.company_id FROM tenant.crm_pipelines pipeline WHERE pipeline.organization_id = $1 AND pipeline.status = 'active' AND ${companyVisible("pipeline")} ORDER BY pipeline.is_default DESC, pipeline.name`,
    parameters,
  );
  const stages = await queryOptions(
    `SELECT stage.id, stage.pipeline_id, stage.name, stage.sequence, stage.probability, stage.is_won, stage.is_lost FROM tenant.crm_pipeline_stages stage JOIN tenant.crm_pipelines pipeline ON pipeline.id = stage.pipeline_id AND pipeline.organization_id = stage.organization_id WHERE stage.organization_id = $1 AND stage.status = 'active' AND ${companyVisible("pipeline")} ORDER BY stage.pipeline_id, stage.sequence`,
    parameters,
  );
  const sources = await queryOptions(
    `SELECT id, name FROM tenant.crm_lead_sources WHERE organization_id = $1 AND status = 'active' ORDER BY is_default DESC, name`,
    parameters,
  );
  const campaigns = await queryOptions(
    `SELECT campaign.id, campaign.name FROM tenant.crm_campaigns campaign WHERE campaign.organization_id = $1 AND campaign.status IN ('planned','active','paused') AND ${companyVisible("campaign")} ORDER BY campaign.name`,
    parameters,
  );
  const users = await queryOptions(
    `SELECT user_account.id, user_account.full_name AS name FROM public.organization_memberships membership JOIN public.users user_account ON user_account.id = membership.user_id WHERE membership.organization_id = $1 AND membership.status = 'active' ORDER BY user_account.full_name`,
    parameters,
  );
  const parties = await queryOptions(
    `SELECT party.id, party.display_name AS name FROM tenant.business_parties party WHERE party.organization_id = $1 AND party.status = 'active' AND ${companyVisible("party")} ORDER BY party.display_name`,
    parameters,
  );
  const contacts = await queryOptions(
    `SELECT contact.id, btrim(contact.first_name || ' ' || COALESCE(contact.last_name,'')) AS name, contact.party_id FROM tenant.contacts contact JOIN tenant.business_parties party ON party.id = contact.party_id AND party.organization_id = contact.organization_id WHERE contact.organization_id = $1 AND contact.status = 'active' AND ${companyVisible("party")} ORDER BY contact.first_name, contact.last_name`,
    parameters,
  );
  const items = await queryOptions(
    `SELECT id, name, sales_price FROM tenant.items WHERE organization_id = $1 AND status = 'active' ORDER BY name`,
    parameters,
  );
  const priceLists = await queryOptions(
    `SELECT id, name, currency_code FROM tenant.price_lists WHERE organization_id = $1 AND status = 'active' ORDER BY name`,
    parameters,
  );
  const tags = await queryOptions(
    `SELECT id, name, color FROM tenant.crm_tags WHERE organization_id = $1 AND status = 'active' ORDER BY name`,
    parameters,
  );
  const lostReasons = await queryOptions(
    `SELECT id, name FROM tenant.crm_lost_reasons WHERE organization_id = $1 AND status = 'active' ORDER BY category, name`,
    parameters,
  );
  const leads = await queryOptions(
    `SELECT lead.id, btrim(lead.first_name || ' ' || COALESCE(lead.last_name,'')) AS name FROM tenant.crm_leads lead WHERE lead.organization_id = $1 AND lead.status NOT IN ('converted','archived') AND ${companyVisible("lead")} AND ${branchVisible("lead")} ORDER BY lead.updated_at DESC LIMIT 500`,
    parameters,
  );
  const opportunities = await queryOptions(
    `SELECT opportunity.id, opportunity.name FROM tenant.crm_opportunities opportunity WHERE opportunity.organization_id = $1 AND opportunity.status <> 'archived' AND ${companyVisible("opportunity")} AND ${branchVisible("opportunity")} ORDER BY opportunity.updated_at DESC LIMIT 500`,
    parameters,
  );
  const sequences = await queryOptions(
    `SELECT id, name FROM tenant.crm_sequences WHERE organization_id = $1 AND status <> 'archived' ORDER BY name`,
    parameters,
  );
  const salesTeams = await queryOptions(
    `SELECT team.id, team.name, team.company_id FROM tenant.crm_sales_teams team WHERE team.organization_id = $1 AND team.status = 'active' AND ${companyVisible("team")} ORDER BY team.name`,
    parameters,
  );
  const territories = await queryOptions(
    `SELECT territory.id, territory.name, territory.company_id FROM tenant.crm_territories territory WHERE territory.organization_id = $1 AND territory.status = 'active' AND ${companyVisible("territory")} ORDER BY territory.name`,
    parameters,
  );
  const forecastPeriods = await queryOptions(
    `SELECT period.id, period.name, period.period_start, period.period_end, period.company_id FROM tenant.crm_forecast_periods period WHERE period.organization_id = $1 AND period.status IN ('planned','open','frozen') AND ${companyVisible("period")} ORDER BY period.period_start DESC`,
    parameters,
  );
  const accountPlans = await queryOptions(
    `SELECT plan.id, party.display_name AS name, plan.company_id FROM tenant.crm_account_plans plan JOIN tenant.business_parties party ON party.id = plan.party_id AND party.organization_id = plan.organization_id WHERE plan.organization_id = $1 AND plan.status = 'active' AND ${companyVisible("plan")} ORDER BY party.display_name`,
    parameters,
  );
  const playbooks = await queryOptions(
    `SELECT playbook.id, playbook.name, playbook.company_id FROM tenant.crm_playbooks playbook WHERE playbook.organization_id = $1 AND playbook.status = 'active' AND ${companyVisible("playbook")} ORDER BY playbook.name`,
    parameters,
  );
  const playbookQuestions = await queryOptions(
    `SELECT question.id, question.prompt AS name, question.playbook_id, question.company_id FROM tenant.crm_playbook_questions question WHERE question.organization_id = $1 AND question.status = 'active' AND ${companyVisible("question")} ORDER BY question.sequence, question.prompt`,
    parameters,
  );
  const conversations = await queryOptions(
    `SELECT conversation.id, COALESCE(conversation.title, initcap(replace(conversation.channel, '_', ' '))) AS name, conversation.company_id FROM tenant.crm_conversations conversation WHERE conversation.organization_id = $1 AND conversation.status <> 'archived' AND ${companyVisible("conversation")} ORDER BY conversation.started_at DESC NULLS LAST, conversation.created_at DESC LIMIT 500`,
    parameters,
  );
  const buyingCommittees = await queryOptions(
    `SELECT committee.id, committee.name, committee.company_id FROM tenant.crm_buying_committees committee WHERE committee.organization_id = $1 AND committee.status = 'active' AND ${companyVisible("committee")} ORDER BY committee.name`,
    parameters,
  );
  const partnerAccounts = await queryOptions(
    `SELECT partner.id, partner.name, partner.company_id FROM tenant.crm_partner_accounts partner WHERE partner.organization_id = $1 AND partner.status = 'active' AND ${companyVisible("partner")} ORDER BY partner.name`,
    parameters,
  );
  const reportDefinitions = await queryOptions(
    `SELECT definition.id, definition.name, definition.company_id FROM tenant.crm_report_definitions definition WHERE definition.organization_id = $1 AND definition.status = 'active' AND ${companyVisible("definition")} ORDER BY definition.name`,
    parameters,
  );
  const dashboards = await queryOptions(
    `SELECT dashboard.id, dashboard.name, dashboard.company_id FROM tenant.crm_dashboards dashboard WHERE dashboard.organization_id = $1 AND dashboard.status = 'active' AND ${companyVisible("dashboard")} ORDER BY dashboard.name`,
    parameters,
  );
  const customObjects = await queryOptions(
    `SELECT definition.id, definition.plural_label AS name, definition.object_key FROM tenant.crm_custom_object_definitions definition WHERE definition.organization_id = $1 AND definition.status = 'active' ORDER BY definition.plural_label`,
    parameters,
  );
  const aiPredictions = await queryOptions(
    `SELECT prediction.id, concat(prediction.entity_type, ': ', prediction.prediction_type) AS name, prediction.company_id FROM tenant.crm_ai_predictions prediction WHERE prediction.organization_id = $1 AND prediction.status = 'active' AND ${companyVisible("prediction")} ORDER BY prediction.created_at DESC LIMIT 500`,
    parameters,
  );
  const recommendations = await queryOptions(
    `SELECT recommendation.id, recommendation.title AS name, recommendation.company_id FROM tenant.crm_recommendations recommendation WHERE recommendation.organization_id = $1 AND recommendation.status IN ('open','accepted') AND ${companyVisible("recommendation")} ORDER BY recommendation.priority DESC, recommendation.created_at DESC LIMIT 500`,
    parameters,
  );

  const map = (result) => result.rows.map(camelizeRow);
  return {
    companies: map(companies),
    branches: map(branches),
    currencies: map(currencies),
    pipelines: map(pipelines),
    stages: map(stages),
    sources: map(sources),
    campaigns: map(campaigns),
    users: map(users),
    parties: map(parties),
    contacts: map(contacts),
    items: map(items),
    priceLists: map(priceLists),
    tags: map(tags),
    lostReasons: map(lostReasons),
    leads: map(leads),
    opportunities: map(opportunities),
    sequences: map(sequences),
    salesTeams: map(salesTeams),
    territories: map(territories),
    forecastPeriods: map(forecastPeriods),
    accountPlans: map(accountPlans),
    playbooks: map(playbooks),
    playbookQuestions: map(playbookQuestions),
    conversations: map(conversations),
    buyingCommittees: map(buyingCommittees),
    partnerAccounts: map(partnerAccounts),
    reportDefinitions: map(reportDefinitions),
    dashboards: map(dashboards),
    customObjects: map(customObjects),
    aiPredictions: map(aiPredictions),
    recommendations: map(recommendations),
  };
}

export async function getCrmDashboard(client, context) {
  const parameters = [
    context.organizationId,
    context.activeCompanyId,
    context.activeBranchId,
    Boolean(context.allowAllCompanies),
  ];
  const companyVisible = (alias) =>
    `($4::boolean OR ($2::uuid IS NOT NULL AND (${alias}.company_id IS NULL OR ${alias}.company_id = $2)))`;
  const branchVisible = (alias) =>
    `($3::uuid IS NULL OR ${alias}.branch_id IS NULL OR ${alias}.branch_id = $3)`;
  const result = await client.query(
    `SELECT
      (SELECT count(*)::int FROM tenant.crm_leads lead WHERE lead.organization_id = $1 AND lead.status NOT IN ('converted','archived') AND ${companyVisible("lead")} AND ${branchVisible("lead")}) AS open_leads,
      (SELECT count(*)::int FROM tenant.crm_leads lead WHERE lead.organization_id = $1 AND lead.status = 'qualified' AND ${companyVisible("lead")} AND ${branchVisible("lead")}) AS qualified_leads,
      (SELECT count(*)::int FROM tenant.crm_opportunities opportunity WHERE opportunity.organization_id = $1 AND opportunity.status = 'open' AND ${companyVisible("opportunity")} AND ${branchVisible("opportunity")}) AS open_opportunities,
      (SELECT COALESCE(sum(opportunity.amount),0)::numeric FROM tenant.crm_opportunities opportunity WHERE opportunity.organization_id = $1 AND opportunity.status = 'open' AND ${companyVisible("opportunity")} AND ${branchVisible("opportunity")}) AS pipeline_value,
      (SELECT COALESCE(sum(opportunity.amount * opportunity.probability / 100),0)::numeric FROM tenant.crm_opportunities opportunity WHERE opportunity.organization_id = $1 AND opportunity.status = 'open' AND ${companyVisible("opportunity")} AND ${branchVisible("opportunity")}) AS weighted_pipeline,
      (SELECT count(*)::int FROM tenant.crm_activities activity WHERE activity.organization_id = $1 AND activity.status NOT IN ('completed','cancelled') AND activity.due_at < now() AND ${companyVisible("activity")} AND ${branchVisible("activity")}) AS overdue_activities,
      (SELECT count(*)::int FROM tenant.crm_activities activity WHERE activity.organization_id = $1 AND activity.status NOT IN ('completed','cancelled') AND activity.due_at >= current_date AND activity.due_at < current_date + interval '1 day' AND ${companyVisible("activity")} AND ${branchVisible("activity")}) AS due_today,
      (SELECT count(*)::int FROM tenant.crm_leads lead WHERE lead.organization_id = $1 AND lead.created_at >= date_trunc('month', now()) AND ${companyVisible("lead")} AND ${branchVisible("lead")}) AS leads_this_month,
      (SELECT count(*)::int FROM tenant.crm_conversion_records conversion JOIN tenant.crm_leads lead ON lead.id = conversion.lead_id AND lead.organization_id = conversion.organization_id WHERE conversion.organization_id = $1 AND conversion.converted_at >= date_trunc('month', now()) AND ${companyVisible("lead")} AND ${branchVisible("lead")}) AS conversions_this_month`,
    parameters,
  );
  const stages = await client.query(
    `SELECT stage.id, stage.name, stage.sequence, count(opportunity.id)::int AS opportunity_count, COALESCE(sum(opportunity.amount),0)::numeric AS amount FROM tenant.crm_pipeline_stages stage JOIN tenant.crm_pipelines pipeline ON pipeline.id = stage.pipeline_id AND pipeline.organization_id = stage.organization_id LEFT JOIN tenant.crm_opportunities opportunity ON opportunity.stage_id = stage.id AND opportunity.organization_id = stage.organization_id AND opportunity.status = 'open' AND ${companyVisible("opportunity")} AND ${branchVisible("opportunity")} WHERE stage.organization_id = $1 AND stage.status = 'active' AND ${companyVisible("pipeline")} GROUP BY stage.id ORDER BY stage.sequence`,
    parameters,
  );
  const sources = await client.query(
    `SELECT COALESCE(source.name,'Unspecified') AS name, count(lead.id)::int AS lead_count, count(lead.id) FILTER (WHERE lead.status = 'converted')::int AS converted_count FROM tenant.crm_leads lead LEFT JOIN tenant.crm_lead_sources source ON source.id = lead.source_id WHERE lead.organization_id = $1 AND ${companyVisible("lead")} AND ${branchVisible("lead")} GROUP BY source.name ORDER BY lead_count DESC LIMIT 10`,
    parameters,
  );
  const activities = await client.query(
    `SELECT activity.*, user_account.full_name AS assigned_name FROM tenant.crm_activities activity LEFT JOIN public.users user_account ON user_account.id = activity.assigned_to WHERE activity.organization_id = $1 AND activity.status NOT IN ('completed','cancelled') AND ${companyVisible("activity")} AND ${branchVisible("activity")} ORDER BY activity.due_at ASC NULLS LAST LIMIT 10`,
    parameters,
  );
  return {
    metrics: camelizeRow(result.rows[0]),
    stages: stages.rows.map(camelizeRow),
    sources: sources.rows.map(camelizeRow),
    activities: activities.rows.map(camelizeRow),
  };
}

export async function getCrmReport(client, context, report, filters = {}) {
  const from = filters.from || null;
  const to = filters.to || null;
  const parameters = [
    context.organizationId,
    context.activeCompanyId,
    context.activeBranchId,
    Boolean(context.allowAllCompanies),
    from,
    to,
  ];
  const dateClause = (column) =>
    `AND ($5::date IS NULL OR ${column} >= $5::date) AND ($6::date IS NULL OR ${column} < $6::date + 1)`;
  const companyVisible = (alias) =>
    `($4::boolean OR ($2::uuid IS NOT NULL AND (${alias}.company_id IS NULL OR ${alias}.company_id = $2)))`;
  const branchVisible = (alias) =>
    `($3::uuid IS NULL OR ${alias}.branch_id IS NULL OR ${alias}.branch_id = $3)`;
  let sql;
  if (report === "pipeline")
    sql = `SELECT stage.name, stage.sequence, count(opportunity.id)::int AS count, COALESCE(sum(opportunity.amount),0)::numeric AS amount, COALESCE(sum(opportunity.amount * opportunity.probability / 100),0)::numeric AS weighted_amount FROM tenant.crm_pipeline_stages stage JOIN tenant.crm_pipelines pipeline ON pipeline.id = stage.pipeline_id AND pipeline.organization_id = stage.organization_id LEFT JOIN tenant.crm_opportunities opportunity ON opportunity.stage_id = stage.id AND opportunity.organization_id = stage.organization_id ${dateClause("opportunity.created_at")} AND ${companyVisible("opportunity")} AND ${branchVisible("opportunity")} WHERE stage.organization_id = $1 AND ${companyVisible("pipeline")} GROUP BY stage.id ORDER BY stage.sequence`;
  else if (report === "conversion")
    sql = `SELECT date_trunc('month', lead.created_at)::date AS period, count(*)::int AS leads, count(*) FILTER (WHERE lead.status='converted')::int AS converted, round((count(*) FILTER (WHERE lead.status='converted')::numeric / NULLIF(count(*),0))*100,2) AS conversion_rate FROM tenant.crm_leads lead WHERE lead.organization_id=$1 ${dateClause("lead.created_at")} AND ${companyVisible("lead")} AND ${branchVisible("lead")} GROUP BY period ORDER BY period`;
  else if (report === "sources")
    sql = `SELECT COALESCE(source.name,'Unspecified') AS source, count(lead.id)::int AS leads, count(lead.id) FILTER (WHERE lead.status='converted')::int AS converted, COALESCE(sum(opportunity.amount) FILTER (WHERE opportunity.status='won'),0)::numeric AS won_revenue FROM tenant.crm_leads lead LEFT JOIN tenant.crm_lead_sources source ON source.id=lead.source_id LEFT JOIN tenant.crm_opportunities opportunity ON opportunity.lead_id=lead.id AND opportunity.organization_id=lead.organization_id WHERE lead.organization_id=$1 ${dateClause("lead.created_at")} AND ${companyVisible("lead")} AND ${branchVisible("lead")} GROUP BY source.name ORDER BY leads DESC`;
  else if (report === "activities")
    sql = `SELECT activity.activity_type, count(*)::int AS total, count(*) FILTER (WHERE activity.status='completed')::int AS completed, count(*) FILTER (WHERE activity.due_at<now() AND activity.status NOT IN ('completed','cancelled'))::int AS overdue FROM tenant.crm_activities activity WHERE activity.organization_id=$1 ${dateClause("activity.created_at")} AND ${companyVisible("activity")} AND ${branchVisible("activity")} GROUP BY activity.activity_type ORDER BY total DESC`;
  else if (report === "forecast")
    sql = `SELECT COALESCE(user_account.full_name,'Unassigned') AS owner, COALESCE(sum(opportunity.amount),0)::numeric AS pipeline, COALESCE(sum(opportunity.amount*opportunity.probability/100),0)::numeric AS weighted, COALESCE(sum(opportunity.amount) FILTER (WHERE opportunity.status='won'),0)::numeric AS won FROM tenant.crm_opportunities opportunity LEFT JOIN public.users user_account ON user_account.id=opportunity.owner_user_id WHERE opportunity.organization_id=$1 ${dateClause("opportunity.created_at")} AND ${companyVisible("opportunity")} AND ${branchVisible("opportunity")} GROUP BY user_account.full_name ORDER BY weighted DESC`;
  else if (report === "campaigns")
    sql = `SELECT campaign.name, campaign.status, campaign.budget, campaign.actual_cost, count(member.id)::int AS members, count(member.id) FILTER (WHERE member.member_status IN ('responded','attended','converted'))::int AS responses, count(member.id) FILTER (WHERE member.member_status='converted')::int AS conversions FROM tenant.crm_campaigns campaign LEFT JOIN tenant.crm_campaign_members member ON member.campaign_id=campaign.id AND member.organization_id=campaign.organization_id WHERE campaign.organization_id=$1 ${dateClause("campaign.created_at")} AND ${companyVisible("campaign")} GROUP BY campaign.id ORDER BY campaign.created_at DESC`;
  else if (report === "revenue-operations")
    sql = `WITH opportunity_rollup AS (
      SELECT opportunity.owner_user_id,
        COALESCE(sum(opportunity.amount) FILTER (WHERE opportunity.status = 'open'),0)::numeric AS pipeline,
        COALESCE(sum(opportunity.amount) FILTER (WHERE opportunity.status = 'open' AND opportunity.forecast_category = 'best_case'),0)::numeric AS best_case,
        COALESCE(sum(opportunity.amount) FILTER (WHERE opportunity.status = 'open' AND opportunity.forecast_category = 'committed'),0)::numeric AS committed,
        COALESCE(sum(opportunity.amount) FILTER (WHERE opportunity.status = 'won'),0)::numeric AS won,
        count(*) FILTER (WHERE opportunity.status = 'won')::int AS won_deals,
        count(*) FILTER (WHERE opportunity.status = 'lost')::int AS lost_deals,
        avg(EXTRACT(epoch FROM (COALESCE(opportunity.actual_close_date::timestamptz, now()) - opportunity.created_at)) / 86400.0) FILTER (WHERE opportunity.status IN ('won','lost')) AS average_sales_cycle_days
      FROM tenant.crm_opportunities opportunity
      WHERE opportunity.organization_id = $1 ${dateClause("opportunity.created_at")}
        AND ${companyVisible("opportunity")} AND ${branchVisible("opportunity")}
      GROUP BY opportunity.owner_user_id
    ), quota_rollup AS (
      SELECT quota.user_id,
        COALESCE(sum(quota.target_amount),0)::numeric AS quota
      FROM tenant.crm_quota_plans quota
      WHERE quota.organization_id = $1
        AND quota.status IN ('active','closed')
        AND ${companyVisible("quota")}
        AND ($5::date IS NULL OR quota.period_end >= $5::date)
        AND ($6::date IS NULL OR quota.period_start <= $6::date)
      GROUP BY quota.user_id
    )
    SELECT COALESCE(user_account.full_name,'Unassigned') AS owner,
      COALESCE(quota_rollup.quota,0)::numeric AS quota,
      COALESCE(opportunity_rollup.pipeline,0)::numeric AS pipeline,
      COALESCE(opportunity_rollup.best_case,0)::numeric AS best_case,
      COALESCE(opportunity_rollup.committed,0)::numeric AS committed,
      COALESCE(opportunity_rollup.won,0)::numeric AS won,
      CASE WHEN COALESCE(quota_rollup.quota,0) > 0 THEN round(COALESCE(opportunity_rollup.pipeline,0) / quota_rollup.quota, 2) ELSE NULL END AS pipeline_coverage,
      CASE WHEN COALESCE(quota_rollup.quota,0) > 0 THEN round(COALESCE(opportunity_rollup.won,0) / quota_rollup.quota * 100, 2) ELSE NULL END AS quota_attainment_percent,
      CASE WHEN COALESCE(opportunity_rollup.won_deals,0) + COALESCE(opportunity_rollup.lost_deals,0) > 0 THEN round(opportunity_rollup.won_deals::numeric / (opportunity_rollup.won_deals + opportunity_rollup.lost_deals) * 100, 2) ELSE NULL END AS win_rate_percent,
      round(COALESCE(opportunity_rollup.average_sales_cycle_days,0)::numeric, 2) AS average_sales_cycle_days
    FROM opportunity_rollup
    FULL OUTER JOIN quota_rollup ON quota_rollup.user_id IS NOT DISTINCT FROM opportunity_rollup.owner_user_id
    LEFT JOIN public.users user_account ON user_account.id = COALESCE(opportunity_rollup.owner_user_id, quota_rollup.user_id)
    ORDER BY won DESC, pipeline DESC`;
  else if (report === "account-health")
    sql = `SELECT party.display_name AS account, plan.account_tier, plan.lifecycle_stage, plan.health_status, plan.health_score, plan.annual_revenue, plan.potential_revenue, plan.renewal_date, plan.next_review_at FROM tenant.crm_account_plans plan JOIN tenant.business_parties party ON party.id = plan.party_id AND party.organization_id = plan.organization_id WHERE plan.organization_id = $1 AND plan.status = 'active' AND ${companyVisible("plan")} ORDER BY CASE plan.health_status WHEN 'critical' THEN 1 WHEN 'at_risk' THEN 2 WHEN 'watch' THEN 3 WHEN 'healthy' THEN 4 ELSE 5 END, plan.next_review_at NULLS LAST`;
  else if (report === "privacy")
    sql = `SELECT request.request_type, request.status, count(*)::int AS requests, count(*) FILTER (WHERE request.due_at < now() AND request.status NOT IN ('completed','rejected','cancelled'))::int AS overdue FROM tenant.crm_privacy_requests request WHERE request.organization_id = $1 ${dateClause("request.created_at")} AND ${companyVisible("request")} GROUP BY request.request_type, request.status ORDER BY request.request_type, request.status`;
  else if (report === "pipeline-intelligence")
    sql = `SELECT inspection.health_status, count(*)::int AS opportunities, round(avg(inspection.health_score),2) AS average_health_score, round(avg(inspection.stage_age_days),2) AS average_stage_age_days, round(avg(inspection.days_since_activity),2) AS average_days_since_activity, count(*) FILTER (WHERE inspection.close_date_slip_days > 0)::int AS slipped_close_dates FROM tenant.crm_pipeline_inspections inspection WHERE inspection.organization_id = $1 ${dateClause("inspection.inspected_at")} AND ${companyVisible("inspection")} GROUP BY inspection.health_status ORDER BY CASE inspection.health_status WHEN 'critical' THEN 1 WHEN 'at_risk' THEN 2 WHEN 'watch' THEN 3 ELSE 4 END`;
  else if (report === "engagement-intelligence")
    sql = `SELECT conversation.channel, count(DISTINCT conversation.id)::int AS conversations, count(insight.id)::int AS insights, count(insight.id) FILTER (WHERE insight.insight_type = 'risk')::int AS risks, count(insight.id) FILTER (WHERE insight.insight_type = 'next_action')::int AS next_actions, count(insight.id) FILTER (WHERE insight.review_status = 'pending')::int AS pending_review FROM tenant.crm_conversations conversation LEFT JOIN tenant.crm_conversation_insights insight ON insight.organization_id = conversation.organization_id AND insight.conversation_id = conversation.id WHERE conversation.organization_id = $1 ${dateClause("conversation.started_at")} AND ${companyVisible("conversation")} GROUP BY conversation.channel ORDER BY conversations DESC`;
  else if (report === "relationship-coverage")
    sql = `SELECT committee.status, count(DISTINCT committee.id)::int AS committees, round(avg(committee.coverage_score),2) AS average_coverage_score, count(member.id)::int AS members, count(member.id) FILTER (WHERE member.member_role = 'economic_buyer')::int AS economic_buyers, count(member.id) FILTER (WHERE member.member_role = 'champion')::int AS champions, count(member.id) FILTER (WHERE member.sentiment IN ('detractor','strong_detractor'))::int AS detractors FROM tenant.crm_buying_committees committee LEFT JOIN tenant.crm_buying_committee_members member ON member.organization_id = committee.organization_id AND member.committee_id = committee.id AND member.status = 'active' WHERE committee.organization_id = $1 ${dateClause("committee.created_at")} AND ${companyVisible("committee")} GROUP BY committee.status ORDER BY committees DESC`;
  else if (report === "partner-pipeline")
    sql = `SELECT partner.partner_type, partner.tier, count(deal.id)::int AS registered_deals, COALESCE(sum(deal.expected_value),0)::numeric AS expected_value, count(deal.id) FILTER (WHERE deal.status = 'won')::int AS won_deals, count(deal.id) FILTER (WHERE deal.status IN ('submitted','approved','active'))::int AS active_deals FROM tenant.crm_partner_accounts partner LEFT JOIN tenant.crm_partner_deals deal ON deal.organization_id = partner.organization_id AND deal.partner_account_id = partner.id ${dateClause("deal.registered_at")} WHERE partner.organization_id = $1 AND partner.status = 'active' AND ${companyVisible("partner")} GROUP BY partner.partner_type, partner.tier ORDER BY expected_value DESC`;
  else if (report === "ai-governance")
    sql = `SELECT prediction.prediction_type, prediction.model_provider, prediction.model_name, count(*)::int AS predictions, round(avg(prediction.score),4) AS average_score, count(feedback.id)::int AS feedback_events, count(feedback.id) FILTER (WHERE feedback.outcome IN ('accepted','correct'))::int AS positive_feedback, count(feedback.id) FILTER (WHERE feedback.outcome IN ('rejected','incorrect','not_actionable'))::int AS negative_feedback FROM tenant.crm_ai_predictions prediction LEFT JOIN tenant.crm_ai_feedback feedback ON feedback.organization_id = prediction.organization_id AND feedback.prediction_id = prediction.id WHERE prediction.organization_id = $1 ${dateClause("prediction.generated_at")} AND ${companyVisible("prediction")} GROUP BY prediction.prediction_type, prediction.model_provider, prediction.model_name ORDER BY predictions DESC`;
  else throw new CrmError(404, "Unknown CRM report.");
  const scopeParametersCte = `crm_scope_parameters AS (
    SELECT $1::uuid AS organization_id,
      $2::uuid AS active_company_id,
      $3::uuid AS active_branch_id,
      $4::boolean AS allow_all_companies,
      $5::date AS date_from,
      $6::date AS date_to
  )`;
  sql = /^\s*WITH\s+/i.test(sql)
    ? sql.replace(/^\s*WITH\s+/i, `WITH ${scopeParametersCte}, `)
    : `WITH ${scopeParametersCte} ${sql}`;

  const result = await client.query(sql, parameters);
  return { report, rows: result.rows.map(camelizeRow), filters: { from, to } };
}

export async function findCrmDuplicates(
  client,
  context,
  input,
  excludeId = null,
) {
  const parameters = [
    context.organizationId,
    input.email || null,
    input.mobile || input.phone || null,
    input.companyName || null,
    excludeId,
  ];
  const result = await client.query(
    `SELECT record.id, record.code, record.full_name, record.email, record.mobile, record.company_name, record.status, (CASE WHEN $2::text IS NOT NULL AND record.normalized_email = tenant.crm_normalize_email($2) THEN 2 ELSE 0 END + CASE WHEN $3::text IS NOT NULL AND record.normalized_phone = tenant.crm_normalize_phone($3) THEN 2 ELSE 0 END + CASE WHEN $4::text IS NOT NULL AND lower(record.company_name) = lower($4) THEN 1 ELSE 0 END) AS match_score FROM tenant.crm_leads record WHERE record.organization_id = $1 AND ($5::uuid IS NULL OR record.id <> $5) AND (($2::text IS NOT NULL AND record.normalized_email = tenant.crm_normalize_email($2)) OR ($3::text IS NOT NULL AND record.normalized_phone = tenant.crm_normalize_phone($3)) OR ($4::text IS NOT NULL AND lower(record.company_name) = lower($4)))${recordScope(resources.leads, context, parameters)} ORDER BY match_score DESC, record.updated_at DESC LIMIT 20`,
    parameters,
  );
  return result.rows.map(camelizeRow);
}

export async function captureCrmLead(
  client,
  formKey,
  input,
  requestContext = {},
) {
  const formResult = await client.query(
    `SELECT * FROM tenant.crm_public_capture_form($1)`,
    [formKey],
  );
  const form = formResult.rows[0];
  if (!form) throw new CrmError(404, "Lead-capture form not found.");
  await client.query(
    "SELECT set_config('app.current_organization_id', $1, true)",
    [form.organization_id],
  );
  const origin = String(requestContext.origin || "");
  if (form.allowed_origins?.length && !form.allowed_origins.includes(origin))
    throw new CrmError(403, "This origin is not allowed to submit the form.");
  if (input.websiteUrl || input.companyWebsiteHidden)
    throw new CrmError(400, "Submission rejected.");
  const fingerprint = String(requestContext.fingerprint || "unknown"),
    window = new Date();
  window.setMinutes(0, 0, 0);
  const rate = await client.query(
    `INSERT INTO tenant.crm_capture_rate_limits (organization_id, form_id, fingerprint, window_started_at, attempts) VALUES ($1,$2,$3,$4,1) ON CONFLICT (organization_id, form_id, fingerprint, window_started_at) DO UPDATE SET attempts=tenant.crm_capture_rate_limits.attempts+1 RETURNING attempts`,
    [form.organization_id, form.id, fingerprint, window],
  );
  if (Number(rate.rows[0].attempts) > Number(form.rate_limit_per_hour))
    throw new CrmError(429, "Too many submissions. Try again later.");
  for (const field of form.required_fields || [])
    if (!input[field] || String(input[field]).trim() === "")
      throw new CrmError(400, `${field} is required.`);
  const context = {
    organizationId: form.organization_id,
    userId: form.owner_user_id || null,
    activeCompanyId: form.company_id,
    activeBranchId: form.branch_id,
    allowAllCompanies: false,
  };
  if (!context.userId) {
    const owner = await client.query(
      `SELECT created_by FROM public.organizations WHERE id=$1`,
      [form.organization_id],
    );
    context.userId = owner.rows[0]?.created_by;
  }
  const duplicates = await findCrmDuplicates(client, context, input);
  const settings = await client.query(
    `SELECT duplicate_policy FROM tenant.crm_settings WHERE organization_id=$1`,
    [form.organization_id],
  );
  if (settings.rows[0]?.duplicate_policy === "block" && duplicates.length)
    throw new CrmError(
      409,
      "A matching lead already exists.",
      "CRM_DUPLICATE_LEAD",
    );
  const lead = await createCrmRecord(client, context, "leads", {
    ...input,
    companyId: form.company_id,
    branchId: form.branch_id,
    sourceId: form.source_id,
    campaignId: form.campaign_id,
    ownerUserId: form.owner_user_id,
  });
  if (form.campaign_id)
    await client.query(
      `INSERT INTO tenant.crm_campaign_members (organization_id,campaign_id,lead_id,member_status,created_by) VALUES ($1,$2,$3,'responded',$4) ON CONFLICT DO NOTHING`,
      [form.organization_id, form.campaign_id, lead.id, context.userId],
    );
  return {
    message: form.success_message,
    leadId: lead.id,
    duplicateWarning: duplicates.length > 0,
  };
}
