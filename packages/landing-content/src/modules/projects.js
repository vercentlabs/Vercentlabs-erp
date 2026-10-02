import { CTAS } from "../navigation.js";
import { capabilityGroup } from "./capability-group.js";
import { PLATFORM_GOVERNANCE } from "./platform-governance.js";

/**
 * Projects — marketing content for the `projects` module of the ERP
 * module catalog (@vercentlabs/shared-types). The catalog owns `key`, `name`,
 * and `description`; `displayName` is the public label. Everything here must
 * stay inside this module's approved launch capabilities
 * (capabilities/launch-capabilities.js).
 */
export const PROJECTS_MODULE = Object.freeze({
  key: "projects",
  displayName: "Projects",
  purpose: "Projects, milestones, tasks, and timesheets.",
  navGroup: "delivery",
  personas: ["Project and delivery managers", "Team members logging time", "Operations leads"],
  painPoints: [
    "Project status buried in spreadsheets",
    "Unclear task ownership",
    "Time tracked inconsistently",
  ],
  bestAngle:
    "Projects broken into milestones and tasks with clear assignees and priorities, timesheets logged against the work, and progress visible to everyone involved.",
  accentColor: { hex: "#0e7490", soft: "#ecfeff", sourcedFromProduct: false },
  directDefinition:
    "The Vercentlabs Projects module organises project delivery — projects, milestones, and tasks with assignees and priorities, project status, timesheets, comments and collaboration, and progress tracking.",
  heroVariant: "operational-sequence",
  searchIntent: "Project management ERP",
  metaDescription:
    "Vercentlabs Projects manages projects, milestones, and tasks with assignees, priorities, status, timesheets, comments, and progress tracking — in the same system as the rest of the business.",
  businessProblems: [
    { title: "No single view of project status", description: "Each project's status lives in a different spreadsheet, so nobody sees the whole picture." },
    { title: "Unclear ownership", description: "Tasks are discussed in meetings and chats, but nobody is clearly assigned." },
    { title: "Time tracked inconsistently", description: "Hours are reconstructed at the end of the week, or not recorded at all." },
    { title: "Context lost in chat", description: "Decisions about the work are scattered across messages instead of attached to the task." },
  ],
  businessOutcomes: [
    { title: "Status everyone can see", description: "Project status and progress tracking show where each project stands." },
    { title: "Clear ownership", description: "Every task has an assignee and a priority." },
    { title: "Time recorded against work", description: "Timesheets are logged against the projects and tasks the time was spent on." },
    { title: "Collaboration in context", description: "Comments stay attached to the project and task they're about." },
  ],
  capabilityGroups: [
    capabilityGroup(
      "projects-planning",
      "Projects & milestones",
      "Projects, the milestones that mark progress through them, and their overall status.",
      ["projects-projects", "projects-milestones", "projects-project-status", "projects-progress-tracking"],
      "project-to-profitability",
    ),
    capabilityGroup(
      "projects-tasks",
      "Tasks & ownership",
      "The work itself, with a clear owner and priority for every task.",
      ["projects-tasks", "projects-assignees", "projects-priority"],
    ),
    capabilityGroup(
      "projects-time-collaboration",
      "Time & collaboration",
      "Time logged against the work, and comments kept with the project and task.",
      ["projects-timesheets", "projects-comments-collaboration"],
    ),
  ],
  primaryWorkflow: {
    name: "Plan to Delivery",
    trigger: "A new project is started.",
    steps: [
      { step: "Set up", detail: "The project is created with its milestones." },
      { step: "Plan the work", detail: "Tasks are created, assigned, and prioritised." },
      { step: "Do and log", detail: "Team members work the tasks and log time on timesheets." },
      { step: "Collaborate", detail: "Comments keep discussion attached to the project and task." },
      { step: "Track", detail: "Project status and progress tracking show how delivery is going against the milestones." },
    ],
    approvals: [],
    automatedActions: ["Progress tracking from task and milestone status"],
    connectedModuleKeys: ["hr-payroll"],
    outcome: "A delivered project with its tasks, time, and discussion on record.",
  },
  connectedModules: [
    { moduleKey: "hr-payroll", relationship: "Project assignees and timesheet users are the same people managed in HR & Payroll." },
    { moduleKey: "support", relationship: "Projects and support tickets run on the same platform, users, and permissions." },
  ],
  reporting: [
    { name: "Project progress", measures: "Status and progress across projects and milestones", audience: "Delivery managers, leadership" },
  ],
  automation: [
    { title: "Progress tracking", description: "Progress reflects the status of the project's tasks and milestones." },
  ],
  governance: [PLATFORM_GOVERNANCE.permissions, PLATFORM_GOVERNANCE.concurrency, PLATFORM_GOVERNANCE.audit],
  implementationConsiderations: [
    "Active projects and their milestones are set up before teams start logging time.",
    "You agree how priorities and project statuses are used across teams.",
    "Team members are trained to log timesheets against the right project and task.",
  ],
  faqs: [
    { question: "Can team members log time against tasks?", answer: "Yes. Timesheets record time against the project and task it was spent on." },
    { question: "Does Vercentlabs Projects include budgets or project billing?", answer: "No. The launch product covers project and task delivery, timesheets, and progress tracking; project budgets, profitability, and billing are not part of it." },
  ],
  screenshots: { primary: "projects-portfolio" },
  conversion: { heading: "See how Vercentlabs Projects would organise your project delivery.", ctaLabel: CTAS.talkToSpecialist.label },
});
