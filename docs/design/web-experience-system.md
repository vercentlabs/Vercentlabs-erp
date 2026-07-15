# Vercent ERP Web Experience System

## Product character

Vercent ERP uses **quiet confidence**: structured, calm and trustworthy rather than decorative. The visual system is designed for repeated daily use by operators, managers, administrators and auditors.

## Core principles

1. **Context before action** — the active organisation, company and branch remain visible.
2. **Attention without alarm** — semantic colour is reserved for states that require interpretation.
3. **Dense, not cramped** — information-rich pages retain clear hierarchy, target sizes and whitespace.
4. **Progressive disclosure** — advanced controls appear where they are needed rather than everywhere.
5. **Trust through feedback** — saving, loading, success and failure states are explicit and accessible.
6. **One system** — authentication, onboarding, administration and future ERP modules share the same tokens and interaction patterns.

## Foundation

- System font stack for speed and predictable rendering.
- 4px-based spacing rhythm with 44px standard controls.
- Neutral canvas, white working surfaces and a deep-navy navigation frame.
- Indigo is the primary action colour; semantic green, amber and rose are used only for state.
- Borders carry most hierarchy; shadows are restrained and reserved for elevated layers.
- Content width is optimised for enterprise tables and forms rather than marketing layouts.

## Accessibility policy

- WCAG 2.2 AA is the baseline.
- All authored controls target at least 44px height, exceeding the 24px WCAG minimum.
- Focus is always visible and not communicated by colour alone.
- Current navigation uses `aria-current`.
- Asynchronous feedback uses status semantics.
- Reduced-motion preferences are respected.
- Forms use persistent labels, contextual help and vertical reading order on narrow screens.

## Page patterns

### Application shell

The shell separates navigation, global search, operating context and account actions. The sidebar is persistent on larger screens and becomes a full navigation panel on smaller screens.

### Dashboards

Dashboards prioritise state and work requiring attention. Counts never imply trends that the system has not measured. Cards link directly to the source records.

### Tables

Tables receive the widest practical content area, sticky headers, aligned row density and horizontal overflow on small screens. Global actions belong in the toolbar above the table.

### Forms

Forms group related fields with descriptive headings. Long setup forms use visible sections instead of a visually flat wall of inputs. Required actions remain prominent and status feedback appears near the submit action.

### Empty and loading states

Empty states explain what will appear and provide a next action where one exists. Container-based screens use skeletons on initial load; inline actions retain local progress text.

## Future module rule

Every new business module must reuse these tokens and patterns. Module teams should extend shared primitives rather than introduce a new visual language.
