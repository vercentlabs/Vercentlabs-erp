# Vercentlabs ERP Experience Kernel

Status: `APPROVED_FOR_ARCHITECTURE_FREEZE`

This is the shared UX contract for every module; modules may specialize behavior but must not create incompatible interaction models without an approved design decision.

## Core workspace primitives
`ERPWorkspace`, `PageHeader`, `RecordHeader`, `Object360`, `EnterpriseDataGrid`, `AdvancedFilters`, `SavedViews`, `StructuredForm`, `QuickCreate`, `KanbanBoard`, `ProcessPath`, `Gantt`, `Calendar`, `ActivityTimeline`, `RelatedRecords`, `BulkActionBar`, `ApprovalTimeline`, `AuditHistory`, `NotificationCenter`, `DocumentViewer`, `MetricCard`, `Dashboard`, `Drilldown`, `CommandPalette`, global search and exception queues.

## State contract
Every major surface specifies loading, empty, partial, stale, optimistic, validation-error, permission-denied, conflict, integration-pending, retrying, failed, offline and recovered states where applicable.

## Responsive/accessibility
Desktop is information-dense; tablet preserves operational workflows; mobile uses task-oriented cards/queues and preserves critical actions. WCAG 2.2 AA intent: keyboard operation, visible focus, semantic labels, screen-reader announcements, accessible errors, contrast, target size, reduced motion and non-drag alternatives. Horizontal boards/Gantt provide keyboard/list alternatives.

## Consistency gate
Implementation cannot mark a capability UX-ready without using approved primitives or documenting why specialization is required. Major screens require visual regression coverage at representative desktop/tablet/mobile breakpoints.
