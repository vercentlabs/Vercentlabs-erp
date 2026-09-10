# CRM UI system

This directory owns reusable CRM presentation compositions and the canonical F001-F030 UI traceability map. Business rules stay in the eight CRM capability directories; reusable ERP primitives stay in `src/shared/design`.

`crm-ui-system.css` is deliberately loaded only by the CRM route layout. It aliases legacy CRM variables to canonical `--erp-*` tokens while the remaining historical component CSS is retired, and it defines the responsive/focus/touch behavior shared by every CRM route.
