export type ModuleHeroVariant = "screenshot-led" | "workflow-led" | "dashboard-led" | "operational-sequence";

// --- Approved launch capability register (capabilities/launch-capabilities.js) ---

/** Owner of a launch capability: one of the 12 ERP module keys, or the Shared Platform. */
export type LaunchCapabilityOwnerKey = string;

export interface LaunchCapability {
  /** Stable, human-readable ID, e.g. "crm-leads". */
  id: string;
  moduleKey: LaunchCapabilityOwnerKey;
  name: string;
}

export interface LaunchCapabilityOwner {
  key: LaunchCapabilityOwnerKey;
  label: string;
  kind: "module" | "platform";
}

export const SHARED_PLATFORM_KEY: "shared-platform";
export const LAUNCH_CAPABILITY_OWNERS: readonly LaunchCapabilityOwner[];
/** The approved MVP capabilities — approved launch scope, not an engineering completion claim. */
export const LAUNCH_CAPABILITIES: readonly LaunchCapability[];
/** Derived count per owner key. */
export const LAUNCH_CAPABILITY_COUNTS: Readonly<Record<LaunchCapabilityOwnerKey, number>>;
/** Derived total — never type this number elsewhere. */
export const LAUNCH_CAPABILITY_TOTAL: number;
export const LAUNCH_BUSINESS_MODULE_COUNT: number;
/** Derived proof line, e.g. "222 approved MVP capabilities across 12 business modules and the Shared Platform". */
export const LAUNCH_CAPABILITY_SUMMARY: string;
export function getLaunchCapability(id: string): LaunchCapability | null;
export function getLaunchCapabilitiesForOwner(ownerKey: LaunchCapabilityOwnerKey): LaunchCapability[];
export function getLaunchCapabilityOwner(ownerKey: LaunchCapabilityOwnerKey): LaunchCapabilityOwner | null;
/** Names for capability IDs; throws on an ID that isn't in the register. */
export function launchCapabilityNames(ids: readonly string[]): string[];

export interface CapabilityGroup {
  id: string;
  name: string;
  description: string;
  /** Launch capability register IDs in this group. */
  capabilityIds: readonly string[];
  /** Display names, derived from capabilityIds via the register. */
  capabilities: readonly string[];
  workflowSlug?: string;
}

export interface BusinessProblem {
  title: string;
  description: string;
}

export interface BusinessOutcome {
  title: string;
  description: string;
}

export interface ConnectedModuleRef {
  moduleKey: string;
  relationship: string;
}

export interface ReportingCapability {
  name: string;
  measures: string;
  audience: string;
}

export interface AutomationCapability {
  title: string;
  description: string;
}

export interface GovernanceCapability {
  title: string;
  description: string;
}

export interface ModuleWorkflowStep {
  step: string;
  detail: string;
}

export interface ModulePrimaryWorkflow {
  name: string;
  trigger: string;
  steps: ModuleWorkflowStep[];
  approvals: string[];
  automatedActions: string[];
  connectedModuleKeys: string[];
  outcome: string;
}

export interface ModuleFaq {
  question: string;
  answer: string;
}

export interface ModuleScreenshotRefs {
  primary?: string;
  secondary?: string;
}

export interface ModuleConversion {
  heading: string;
  ctaLabel: string;
}

export interface LandingModule {
  key: string;
  /** Catalog (engineering) name, e.g. "Stock". */
  name: string;
  /** The one public, buyer-facing label, e.g. "Inventory". */
  displayName: string;
  /** One-line, buyer-facing purpose for compact module lists — stays inside the module's approved capabilities. */
  purpose: string;
  description: string;
  availability: string;
  navGroup: string;
  personas: string[];
  painPoints: string[];
  bestAngle: string;
  accentColor: { hex: string; soft: string; sourcedFromProduct: boolean };
  directDefinition: string;
  heroVariant: ModuleHeroVariant;
  searchIntent: string;
  metaDescription: string;
  businessProblems: BusinessProblem[];
  businessOutcomes: BusinessOutcome[];
  capabilityGroups: CapabilityGroup[];
  primaryWorkflow: ModulePrimaryWorkflow;
  connectedModules: ConnectedModuleRef[];
  reporting: ReportingCapability[];
  automation: AutomationCapability[];
  governance: GovernanceCapability[];
  implementationConsiderations: string[];
  faqs: ModuleFaq[];
  screenshots: ModuleScreenshotRefs;
  conversion: ModuleConversion;
}

export const LANDING_MODULES: readonly LandingModule[];
export function getLandingModule(key: string): LandingModule | null;
export function getModulesByNavGroup(navGroup: string): LandingModule[];

export interface WorkflowSequenceStep {
  step: string;
  moduleKey: string;
  detail: string;
}

export interface WorkflowFaq {
  question: string;
  answer: string;
}

export interface LandingWorkflow {
  slug: string;
  name: string;
  modules: string[];
  summary: string;
  iaPriority: "P0" | "P1" | "P2";
  /** The following fields are only populated for the 6 routed workflows (ROUTED_WORKFLOW_SLUGS). */
  /** A direct-answer sentence distinct from `summary` — rendered in DirectDefinition, never the same text as the hero subhead. */
  directDefinition?: string;
  trigger?: string;
  participants?: string[];
  sequence?: WorkflowSequenceStep[];
  automatedActions?: string[];
  approvals?: string[];
  exceptions?: string[];
  visibility?: string[];
  businessValue?: string[];
  faqs?: WorkflowFaq[];
  screenshotId?: string;
  /** Launch capability register IDs the routed sequence relies on (capabilities/launch-capabilities.js). */
  capabilityIds?: readonly string[];
}

export const LANDING_WORKFLOWS: readonly LandingWorkflow[];
export const ROUTED_WORKFLOW_SLUGS: readonly string[];
export function getWorkflowsForModule(moduleKey: string): LandingWorkflow[];
export function getWorkflow(slug: string): LandingWorkflow | null;
export function getRoutedWorkflows(): LandingWorkflow[];
/** Routed workflows whose sequence includes a module, most relevant first (share of steps owned, then routed order). */
export function getRoutedWorkflowsForModule(moduleKey: string): LandingWorkflow[];
/** A routed workflow's steps grouped into consecutive runs by owning module. */
export function getWorkflowModulePath(slug: string): { moduleKey: string; steps: string[] }[];
/** A routed workflow's capabilities, grouped by owning module (or "shared-platform"), in workflow order. */
export function getWorkflowCapabilityGroups(slug: string): { ownerKey: string; capabilities: string[] }[];

export const WORKFLOWS_INDEX_PAGE: {
  slug: string;
  title: string;
  metaDescription: string;
  eyebrow: string;
  heading: string;
  supportingText: string;
  listHeading: string;
  singleModuleHeading: string;
  singleModuleSupportingText: string;
  finalCta: { heading: string; supportingText: string };
};

/** Section copy shared by every /workflows/[slug] page. */
export const WORKFLOW_DETAIL_PAGE: {
  eyebrow: string;
  triggerLabel: string;
  scopeLabel: (steps: number, modules: number) => string;
  finalHeading: (name: string) => string;
  allWorkflowsLabel: string;
  sequenceEyebrow: string;
  sequenceHeading: string;
  capabilitiesEyebrow: string;
  capabilitiesHeading: string;
  capabilitiesSupportingText: string;
  evidenceEyebrow: string;
  evidenceHeading: string;
  modulesEyebrow: string;
  modulesHeading: string;
  relatedEyebrow: string;
  faqEyebrow: string;
  faqHeading: string;
};

export interface LandingIcp {
  slug: string;
  industrySlugs: string[];
  name: string;
  triggerEvent: string;
  primaryModules: string[];
  primaryWorkflow: string;
}

export const LANDING_ICPS: readonly LandingIcp[];
export function getIcp(slug: string): LandingIcp | null;

export interface NavGroup {
  key: string;
  label: string;
  moduleKeys: string[];
}

export const MODULE_NAV_GROUPS: readonly NavGroup[];

export interface NavItem {
  label: string;
  href: string;
  children?: readonly { label: string; href: string }[];
}

export const PRIMARY_NAV: readonly NavItem[];

export interface Cta {
  label: string;
  href: string;
}

/** The global CTA contract — see navigation.js. Components render CTAs by role. */
export const CTAS: {
  /** Main evaluation action. Today "Explore the ERP" → /product. */
  primary: Cta;
  /** Assisted evaluation through the /book-demo lead form. */
  talkToSpecialist: Cta;
  /** The same form, where a tailored demo is explicitly the ask. */
  bookDemo: Cta;
};
export const SIGN_IN_LABEL: string;

export interface AnnouncementBannerContent {
  id: string;
  message: string;
  ctaLabel: string;
  href: string;
}
/** null when there is no real announcement — the bar then doesn't render. */
export const ANNOUNCEMENT_BANNER: AnnouncementBannerContent | null;

export const ANALYTICS_EVENTS: readonly [
  "homepage_view",
  "demo_form_start",
  "demo_form_validation_error",
  "demo_form_submit",
  "demo_form_success",
  "demo_form_error",
  "product_demo_complete",
  "product_tour_play",
  "module_page_view",
  "industry_page_view",
  "module_hero_cta_click",
  "module_workflow_view",
  "module_related_link_click",
  "module_mid_cta_click",
  "module_final_cta_click",
  "platform_page_view",
  "platform_cta_click",
  "modules_index_view",
  "industries_index_view",
  "industry_final_cta_click",
  "solutions_index_view",
  "solution_page_view",
  "solution_cta_click",
  "workflows_index_view",
  "workflow_page_view",
  "workflow_cta_click",
  "implementation_page_view",
  "implementation_cta_click",
  "resources_index_view",
  "resource_page_view",
  "resource_cta_click",
  "resource_related_click",
  "requirements_filter",
  "requirements_print",
  "glossary_index_view",
  "glossary_page_view",
  "compare_index_view",
  "comparison_page_view",
  "comparison_cta_click",
  "source_link_click",
  "web_vitals_lcp",
  "web_vitals_inp",
  "web_vitals_cls",
  "announcement_banner_view",
  "announcement_banner_cta_click",
  "announcement_banner_dismiss",
];

export const SITE_IDENTITY: { name: string; productName: string; titleTemplate: string; category: string };
/** The master brand contract — see metadata.js. */
export const POSITIONING: {
  heroHeadline: string;
  masterPromise: string;
  coreIdea: string;
  problemStatement: string;
  descriptor: string;
};
export const COMPANY_IDENTITY: {
  legalName: string;
  entityType: string;
  country: string;
  registeredAddress: string | null;
  llpin: string | null;
  primaryContactEmail: string;
  salesContactEmail: string;
  privacyContactEmail: string;
  supportContactEmail: string;
  securityContactEmail: string;
  careersContactEmail: string;
  billingContactEmail: string;
};

// --- Homepage content model (homepage.js) ---

/** Every analyticsId value declared on a homepage section or CTA in homepage.js. */
export type HomepageAnalyticsId =
  | "hero_view"
  | "hero_primary_cta_click"
  | "hero_secondary_cta_click"
  | "connected_erp_view"
  | "problem_section_view"
  | "workflow_view"
  | "workflow_interaction"
  | "module_group_view"
  | "platform_section_view"
  | "role_value_view"
  | "breadth_section_view"
  | "evaluation_section_view"
  | "evaluation_path_click"
  | "implementation_section_view"
  | "security_section_view"
  | "buyer_questions_view"
  | "final_cta_view"
  | "final_cta_click"
  | "final_secondary_cta_click";

export interface HomepageCta {
  label: string;
  href: string;
  analyticsId: HomepageAnalyticsId;
}

export interface HomepageLink {
  label: string;
  href: string;
}

export interface HomepageSectionBase {
  id: string;
  eyebrow?: string;
  heading: string;
  supportingText?: string;
  analyticsId: HomepageAnalyticsId;
}

export const HOMEPAGE_METADATA: { title: string; description: string };

export interface HeroContent extends HomepageSectionBase {
  primaryCta: HomepageCta;
  secondaryCta: HomepageCta;
  evidence: { value: string; label: string }[];
  screenshotId: string;
}
export const HERO: HeroContent;

export interface ConnectedErpSection extends HomepageSectionBase {
  layers: { key: "modules" | "core" | "platform"; label: string; description: string }[];
  mapCaption: string;
  /** The routed workflow the connected-ERP map traces. */
  route: { workflowSlug: string; label: string; moduleKeys: string[] };
}
export const CONNECTED_ERP_SECTION: ConnectedErpSection;

export interface ProblemSection extends HomepageSectionBase {
  fragmented: { label: string; systems: string[]; handoffs: string[] };
  connected: { label: string; summary: string; moduleKeys: string[] };
  items: { title: string; description: string }[];
}
export const PROBLEM_SECTION: ProblemSection;

export interface ConnectedWorkflowsSection extends HomepageSectionBase {
  /** Routed workflow slugs, in tab order; the first is the server-rendered default. */
  workflowSlugs: string[];
  interactionAnalyticsId: HomepageAnalyticsId;
}
export const CONNECTED_WORKFLOWS_SECTION: ConnectedWorkflowsSection;

export interface ModuleArchitectureSection extends HomepageSectionBase {
  groupSummaries: { groupKey: string; outcome: string }[];
  /** The Shared Platform shown as the common foundation under the module groups. */
  platform: { label: string; summary: string; href: string; highlights: string[] };
}
export const MODULE_ARCHITECTURE_SECTION: ModuleArchitectureSection;

export interface PlatformFoundationSection extends HomepageSectionBase {
  /** Control families; capability names are derived from the launch register. */
  families: { key: string; title: string; description: string; capabilities: string[] }[];
}
export const PLATFORM_FOUNDATION_SECTION: PlatformFoundationSection;

export interface RoleValueSection extends HomepageSectionBase {
  roles: { role: string; gains: string; moduleKeys: string[] }[];
}
export const ROLE_VALUE_SECTION: RoleValueSection;

export interface BreadthSection extends HomepageSectionBase {
  /** Capability count per owner, derived from the register — business modules in module-group order, then the Shared Platform. */
  distribution: { key: string; label: string; count: number }[];
  breakdown: { label: string; value: string; description: string }[];
  cta: HomepageLink;
}
export const BREADTH_SECTION: BreadthSection;

export interface EvaluationSection extends HomepageSectionBase {
  paths: { key: string; title: string; description: string; cta: HomepageLink }[];
  pathAnalyticsId: HomepageAnalyticsId;
}
export const EVALUATION_SECTION: EvaluationSection;

export interface ImplementationSection extends HomepageSectionBase {
  steps: { step: string; title: string; description: string }[];
}
export const IMPLEMENTATION_SECTION: ImplementationSection;

export interface SecuritySection extends HomepageSectionBase {
  accessChain: { label: string; detail: string }[];
  traceChain: { label: string; detail: string }[];
  items: { title: string; description: string }[];
  cta: HomepageLink;
}
export const SECURITY_SECTION: SecuritySection;

export interface BuyerQuestionsSection extends HomepageSectionBase {
  questions: { question: string; answer: string }[];
}
export const BUYER_QUESTIONS_SECTION: BuyerQuestionsSection;

export interface FinalCtaSection extends HomepageSectionBase {
  primaryCta: HomepageCta;
  secondaryCta: HomepageCta;
}
export const FINAL_CTA_SECTION: FinalCtaSection;

export const HOMEPAGE_SECTIONS: readonly HomepageSectionBase[];

export const COLOR_TOKENS: Record<string, string>;
export const RADIUS_TOKENS: Record<string, number>;
export const SPACING_SCALE: readonly number[];
export const SHADOW_TOKENS: Record<string, string>;
export const CONTAINER_TOKENS: { maxWidth: number; gridColumns: number };
export const BREAKPOINT_TOKENS: Record<string, number>;
export const MOTION_TOKENS: {
  hoverLiftPx: number;
  durationFastMs: number;
  durationBaseMs: number;
  easing: string;
  respectsReducedMotion: boolean;
};
export const TYPOGRAPHY_TOKENS: {
  fontFamily: string;
  headlineTrackingEm: number;
  bodyLineHeight: number;
  numericVariant: string;
};

export const SEMANTIC_BACKGROUND: Record<"page" | "subtle" | "inverse" | "elevated" | "brand" | "selected", string>;
export const SEMANTIC_TEXT: Record<"primary" | "secondary" | "muted" | "inverse" | "brand" | "link" | "disabled", string>;
export const SEMANTIC_BORDER: Record<"default" | "strong" | "subtle" | "brand" | "error" | "focus", string>;
export const SEMANTIC_STATE: Record<
  "success" | "successSoft" | "warning" | "warningSoft" | "error" | "errorSoft" | "information" | "informationSoft" | "focus" | "disabled",
  string
>;
export const SEMANTIC_PRODUCT: Record<"frame" | "chrome" | "canvas" | "annotation" | "highlight", string>;

// --- Capability groups (capabilities/capability-registry.js) ---

/**
 * Public grouping of the launch capability register (capabilities/capability-registry.js):
 * module groups come from each module's capabilityGroups; Shared Platform
 * groups are declared there. Every register capability is in exactly one group.
 */
export interface CapabilityGroupRecord {
  id: string;
  name: string;
  moduleId?: string;
  platformArea?: string;
  description: string;
  capabilityIds: readonly string[];
  capabilities: readonly string[];
  workflowSlugs: string[];
  publicPage: string;
  publicSection: string;
  searchTopics: string[];
}

export const CAPABILITY_GROUPS: readonly CapabilityGroupRecord[];
export const SHARED_PLATFORM_CAPABILITY_GROUPS: readonly CapabilityGroupRecord[];
export function getCapabilityGroupsForModule(moduleKey: string): CapabilityGroupRecord[];
export function getCapabilityGroupsForPlatformArea(platformArea: string): CapabilityGroupRecord[];
/** The owner key of a group: its moduleId, or SHARED_PLATFORM_KEY. */
export function getCapabilityGroupOwner(group: CapabilityGroupRecord): LaunchCapabilityOwnerKey;

// --- Product overview and platform pages (platform/*.js) ---

/** A CTA whose analytics event isn't one of the homepage's fixed section IDs. */
export interface PageCta {
  label: string;
  href: string;
}

export interface PlatformFeatureItem {
  title: string;
  description: string;
}

export interface PlatformPageSection {
  id: string;
  eyebrow?: string;
  heading: string;
  supportingText?: string;
  items: PlatformFeatureItem[];
}

export interface PlatformPageContent {
  slug: string;
  title: string;
  metaDescription: string;
  directDefinition: string;
  eyebrow: string;
  heading: string;
  supportingText: string;
  heroScreenshotId?: string;
  sections: PlatformPageSection[];
  connectedModuleKeys: string[];
  faqs?: ModuleFaq[];
  primaryCta: PageCta;
  /** Hand-written, not derived from `title` — a naive title.toLowerCase() breaks on acronym titles ("Mobile ERP" -> "mobile erp"). */
  finalCtaHeading: string;
}

export const PLATFORM_PAGE: PlatformPageContent;
export const AUTOMATION_PAGE: PlatformPageContent;
export const ANALYTICS_PAGE: PlatformPageContent;
export const MOBILE_PAGE: PlatformPageContent;
export const INTEGRATIONS_PAGE: PlatformPageContent;
export const SECURITY_PAGE: PlatformPageContent;
export const PLATFORM_PAGES: readonly PlatformPageContent[];

export interface LegalPageSection {
  id: string;
  heading: string;
  paragraphs: string[];
}

export interface LegalPageContent {
  slug: string;
  title: string;
  metaDescription: string;
  lastReviewedAt: string;
  sections: readonly LegalPageSection[];
}

export const PRIVACY_PAGE: LegalPageContent;
export const TERMS_PAGE: LegalPageContent;

export interface PageLink {
  label: string;
  href: string;
}

export interface PageSectionCopy {
  eyebrow: string;
  heading: string;
  supportingText?: string;
}

export interface ProductOverviewPage {
  slug: string;
  title: string;
  metaDescription: string;
  directDefinition: string;
  eyebrow: string;
  heading: string;
  supportingText: string;
  primaryCta: PageLink;
  secondaryCta: PageLink;
  /** Derived figures: module count, routed workflow count, Shared Platform capability count. */
  facts: { value: string; label: string }[];
  architecture: PageSectionCopy & { layers: { key: "modules" | "workflows" | "platform"; title: string; description: string }[] };
  evidence: PageSectionCopy & { primaryScreenshotId: string; secondaryScreenshotId: string };
  modulesSection: PageSectionCopy;
  workflowsSection: PageSectionCopy;
  platformSection: PageSectionCopy & { cta: PageLink };
  controlsSection: PageSectionCopy & { items: { title: string; description: string }[]; cta: PageLink };
  evaluation: PageSectionCopy;
  finalCta: { heading: string; supportingText: string; primaryCta: PageLink; secondaryCta: PageLink };
  faqSection: PageSectionCopy;
  faqs: ModuleFaq[];
}

export const PRODUCT_OVERVIEW_PAGE: ProductOverviewPage;

export interface OperatingStack {
  id: string;
  name: string;
  description: string;
  moduleKeys: string[];
}

export interface ModulesIndexPage {
  slug: string;
  title: string;
  metaDescription: string;
  directDefinition: string;
  eyebrow: string;
  heading: string;
  supportingText: string;
  groupsSection: PageSectionCopy;
  relationshipsSection: PageSectionCopy;
  platformSection: PageSectionCopy & { cta: PageLink };
  stacksSection: PageSectionCopy;
  operatingStacks: OperatingStack[];
  finalCta: { heading: string; supportingText: string; primaryCta: PageLink; secondaryCta: PageLink };
}

export const MODULES_INDEX_PAGE: ModulesIndexPage;

/** Section copy shared by every /modules/[slug] page. */
export const MODULE_DETAIL_PAGE: {
  evidenceEyebrow: string;
  evidenceFallbackLabel: string;
  managesEyebrow: string;
  managesHeading: (name: string) => string;
  capabilitiesEyebrow: string;
  capabilitiesHeading: (name: string, count: number) => string;
  capabilitiesSupportingText: string;
  workflowEyebrow: string;
  workflowHeading: (name: string) => string;
  connectionsEyebrow: string;
  connectionsHeading: (name: string) => string;
  platformEyebrow: string;
  platformHeading: string;
  platformSupportingText: string;
  faqEyebrow: string;
  faqHeading: (name: string) => string;
  relatedEyebrow: string;
};

// --- Buyer roles (buyer-roles.js) ---

export interface BuyerRole {
  slug: string;
  title: string;
  concernSummary: string;
  primaryConcerns: string[];
  relevantModuleKeys: string[];
  proofPoint: string;
}

export const BUYER_ROLES: readonly BuyerRole[];
export function getBuyerRole(slug: string): BuyerRole | null;
export function getBuyerRolesBySlugs(slugs: string[]): BuyerRole[];

// --- Industry pages (industries.js) ---

export interface IndustryModuleStackEntry {
  moduleKey: string;
  role: string;
}

export interface IndustryPage {
  slug: string;
  icpSlug: string;
  name: string;
  directDefinition: string;
  operatingModel: string;
  challenges: string[];
  moduleStack: IndustryModuleStackEntry[];
  primaryWorkflowSlug?: string;
  buyerRoleSlugs: string[];
  evidenceHighlights: string[];
  screenshots: { primary?: string };
  faqs: ModuleFaq[];
  metaDescription: string;
  searchIntent: string;
  conversion: ModuleConversion;
}

export const LANDING_INDUSTRIES: readonly IndustryPage[];
export function getIndustry(slug: string): IndustryPage | null;
export function getIndustriesForModule(moduleKey: string): IndustryPage[];
export function getIndustriesForWorkflow(workflowSlug: string): IndustryPage[];

// --- Solution pages (solutions.js) ---

export interface SolutionApproachItem {
  title: string;
  description: string;
  moduleKey?: string;
}

export interface SolutionPage {
  slug: string;
  name: string;
  /** A direct-answer sentence distinct from `problemStatement` — rendered in DirectDefinition, never the same text as the hero subhead. */
  directDefinition: string;
  problemStatement: string;
  before: string;
  after: string;
  approach: SolutionApproachItem[];
  /** The one paired platform page this solution differentiates against — an absolute path, e.g. "/product/automation". */
  relatedPlatformPageSlug: string;
  relatedModuleKeys: string[];
  relatedWorkflowSlugs: string[];
  /** Only present where a real approved screenshot honestly illustrates this page's approach claims — see solutions.js's header comment. */
  screenshotId?: string;
  faqs: ModuleFaq[];
  metaDescription: string;
  searchIntent: string;
  conversion: ModuleConversion;
}

export const LANDING_SOLUTIONS: readonly SolutionPage[];
export function getSolution(slug: string): SolutionPage | null;
export function getSolutionsForModule(moduleKey: string): SolutionPage[];

// --- Implementation & migration page (implementation.js) ---

export interface ImplementationPhase {
  id: string;
  name: string;
  description: string;
  activities: string[];
  typicalOutputs: string[];
  /** Only set on the Data Migration phase. */
  migrationChecklist?: string[];
}

export interface ImplementationPage {
  slug: string;
  title: string;
  metaDescription: string;
  directDefinition: string;
  searchIntent: string;
  eyebrow: string;
  heading: string;
  supportingText: string;
  phases: ImplementationPhase[];
  faqs: ModuleFaq[];
  conversion: ModuleConversion;
}

export const IMPLEMENTATION_PAGE: ImplementationPage;

// --- Content freshness registry (freshness.js) ---

export interface ContentFreshness {
  /** ISO date (YYYY-MM-DD) of the route's first real, substantive commit. */
  publishedAt: string;
  /** ISO date of the most recent significant content change (never a build timestamp). */
  lastModifiedAt: string;
  /** ISO date this route was last manually reviewed, even if unchanged. */
  lastReviewedAt: string;
  /** Plain-language statement of what the last significant change actually was. */
  reviewReason: string;
}

export const CONTENT_FRESHNESS: Readonly<Record<string, ContentFreshness>>;
export function getFreshness(path: string): ContentFreshness;
export function hasFreshness(path: string): boolean;

// --- Editorial source registry (sources.js) ---

export type EditorialSourceType = "government" | "standard" | "vendor" | "industry-body" | "research" | "documentation";

export interface EditorialSource {
  id: string;
  url: string;
  title: string;
  publisher: string;
  /** ISO date this source was actually fetched/checked, not when it was first written. */
  retrievedAt: string;
  sourceType: EditorialSourceType;
  summary: string;
}

export const EDITORIAL_SOURCES: readonly EditorialSource[];
export function getSource(id: string): EditorialSource | null;

// --- Content author registry (authors.js) ---

export interface ContentAuthor {
  id: string;
  name: string;
  role?: string;
  bio?: string;
  image?: string;
  profileUrl?: string;
  verified: boolean;
}

export const CONTENT_AUTHORS: readonly ContentAuthor[];
export function getAuthor(id: string): ContentAuthor | null;

// --- AEO answer library (answers.js) ---

export interface AeoAnswer {
  id: string;
  question: string;
  entity: string;
  directAnswer: string;
  expandedExplanation: string;
  relatedRoute: string;
  sourceIds?: string[];
  lastReviewedAt: string;
}

export const AEO_ANSWERS: readonly AeoAnswer[];
export function getAnswer(id: string): AeoAnswer | null;

// --- Glossary (glossary.js) ---

export interface GlossaryTermBase {
  term: string;
  shortDefinition: string;
  standalone: boolean;
}

export interface GlossaryIndexEntry extends GlossaryTermBase {
  standalone: false;
  relatedRoute?: string;
}

export interface GlossaryStandaloneEntry extends GlossaryTermBase {
  standalone: true;
  slug: string;
  definition: string;
  whyItMatters: string;
  howItWorks: string;
  example: string;
  relatedTerms: string[];
  relatedModules: string[];
  vercentlabsHandling: string;
  relatedWorkflow: string | null;
  lastReviewedAt: string;
}

export type GlossaryTerm = GlossaryIndexEntry | GlossaryStandaloneEntry;

export const GLOSSARY_TERMS: readonly GlossaryTerm[];
export const STANDALONE_GLOSSARY_SLUGS: readonly string[];
export function getGlossaryTerm(slug: string): GlossaryStandaloneEntry | null;

// --- Resource guides (resources.js) ---

export interface ResourceSection {
  id: string;
  heading: string;
  paragraphs: string[];
}

export interface ResourceGuide {
  slug: string;
  category: string;
  title: string;
  dek: string;
  keyTakeaways: string[];
  sections: ResourceSection[];
  faqs: ModuleFaq[];
  relatedModuleKeys: string[];
  relatedWorkflowSlugs: string[];
  relatedResourceSlugs: string[];
  metaDescription: string;
  searchIntent: string;
  conversion: ModuleConversion;
}

export const RESOURCE_GUIDES: readonly ResourceGuide[];
export const RESOURCE_CATEGORIES: readonly string[];
export function getResourceGuide(slug: string): ResourceGuide | null;
export function getResourceGuidesForModule(moduleKey: string): ResourceGuide[];

// --- Comparisons (comparisons.js) ---

export interface ComparisonEvidence {
  claimId: string;
  competitor: string;
  claim: string;
  sourceUrl: string;
  sourceTitle: string;
  verifiedAt: string;
  sourceType: EditorialSourceType;
}

export interface ComparisonDimension {
  id: string;
  title: string;
  odoo: string;
  vercentlabs: string;
  evidenceIds: string[];
}

export interface ComparisonPage {
  slug: string;
  competitor: string;
  metaDescription: string;
  searchIntent: string;
  directAnswer: string;
  dimensions: ComparisonDimension[];
  strongerFitForOdoo: string[];
  strongerFitForVercentlabs: string[];
  faqs: ModuleFaq[];
}

export const ODOO_COMPARISON_EVIDENCE: readonly ComparisonEvidence[];
export const VERCENTLABS_VS_ODOO: ComparisonPage;
export function getComparisonEvidence(claimId: string): ComparisonEvidence | null;
