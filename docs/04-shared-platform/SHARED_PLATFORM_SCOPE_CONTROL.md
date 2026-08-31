# Shared Platform Scope Control

Status: `AUTHORITY_FROZEN`

The canonical business-feature register remains exactly **F001-F510**. The exact shared-platform baseline is separately governed as **SP001-SP036** and is not counted inside the 510.

## Rules
- Never invent F511+ to represent platform requirements.
- `SHARED_PLATFORM_REGISTER.csv` is the controlling identity/name/count authority for SP001-SP036.
- Shared-platform requirements are reusable platform capabilities, not a hidden thirteenth business module.
- A business module may depend on SP capabilities but may not clone weaker private implementations of tenancy, authorization, audit, jobs, files, API security, accessibility, etc.
- Changing an SP ID/name/count after this freeze requires explicit change control and an impact analysis across module requirements, architecture, tests and implementation waves.
