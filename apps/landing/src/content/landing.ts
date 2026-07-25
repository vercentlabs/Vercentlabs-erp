import {
  Activity,
  BadgeCheck,
  BarChart3,
  Building2,
  ClipboardCheck,
  ContactRound,
  Database,
  Fingerprint,
  GitBranch,
  Import,
  LockKeyhole,
  MessagesSquare,
  Radar,
  Route,
  ScanSearch,
  ShieldCheck,
  Target,
  TimerReset,
} from "lucide-react";

export const operatingSteps = [
  {
    number: "01",
    icon: Radar,
    title: "Capture the signal",
    description:
      "Bring staff entry, imports and governed public forms into one lead record with source, campaign and consent context.",
    evidence: "Origin, consent and duplicate controls",
  },
  {
    number: "02",
    icon: Target,
    title: "Decide what matters",
    description:
      "Use score, ownership, follow-up and qualification states to make the next action visible instead of buried in chat or spreadsheets.",
    evidence: "Scoring and assignment history",
  },
  {
    number: "03",
    icon: Route,
    title: "Progress with control",
    description:
      "Move opportunities through explicit stages with value, probability, activity and approval context attached to the record.",
    evidence: "Permission and approval boundaries",
  },
  {
    number: "04",
    icon: BarChart3,
    title: "Review the operating truth",
    description:
      "Inspect pipeline, overdue work, forecast and record timelines without rebuilding the business in separate reports.",
    evidence: "Audit-ready history and reports",
  },
] as const;

export const releasedCapabilities = [
  {
    icon: ContactRound,
    title: "Lead and contact records",
    description: "Structured customer context, ownership and source history.",
  },
  {
    icon: GitBranch,
    title: "Opportunity pipeline",
    description:
      "Configurable stages, value, probability and forecast context.",
  },
  {
    icon: Activity,
    title: "Activities and follow-up",
    description: "Calls, meetings, tasks, due dates and completion history.",
  },
  {
    icon: Import,
    title: "Controlled data intake",
    description: "Staff entry, CSV imports and signed public capture routes.",
  },
  {
    icon: MessagesSquare,
    title: "Customer timeline",
    description: "A chronological record of changes, actions and interactions.",
  },
  {
    icon: ScanSearch,
    title: "Search and reporting",
    description: "Operational lookup, pipeline views and governed reporting.",
  },
] as const;

export const governanceControls = [
  {
    icon: LockKeyhole,
    label: "Permission",
    title: "Show only what the role can use",
    description:
      "Navigation, records and mutation controls respond to real permission scope.",
  },
  {
    icon: Building2,
    label: "Context",
    title: "Keep company and branch boundaries explicit",
    description:
      "Operating context is revalidated rather than silently trusted between sessions.",
  },
  {
    icon: ClipboardCheck,
    label: "Decision",
    title: "Turn sensitive changes into governed commands",
    description:
      "Supported actions can be requested, reviewed and executed transactionally.",
  },
  {
    icon: Fingerprint,
    label: "Evidence",
    title: "Preserve a usable audit trail",
    description:
      "Important changes retain who, what, when and operating-context evidence.",
  },
] as const;

export const implementationSteps = [
  {
    number: "01",
    title: "Map the operating problem",
    description:
      "Document current systems, handoffs, roles, data ownership and the result the team needs.",
  },
  {
    number: "02",
    title: "Configure a narrow pilot",
    description:
      "Start with a controlled CRM workflow, real users and explicit acceptance criteria.",
  },
  {
    number: "03",
    title: "Validate before expansion",
    description:
      "Review adoption, controls and data quality before broader rollout or roadmap work.",
  },
] as const;

export const integrityPoints = [
  {
    icon: BadgeCheck,
    title: "Released means usable",
    description:
      "CRM is the only module presented as released early-access scope.",
  },
  {
    icon: Database,
    title: "Foundation means shared",
    description:
      "Identity, permissions, context, audit and master data are platform concerns.",
  },
  {
    icon: ShieldCheck,
    title: "Roadmap means not shipped",
    description:
      "Eleven modules remain visible future scope, not disguised product claims.",
  },
  {
    icon: TimerReset,
    title: "Pilots create the evidence",
    description:
      "No invented logos, testimonials or success metrics are used as proof.",
  },
] as const;

export const buyerQuestions = [
  "Where does customer truth live today?",
  "Who owns each handoff and next action?",
  "Which decisions need control or approval?",
  "What evidence must remain after the change?",
] as const;
