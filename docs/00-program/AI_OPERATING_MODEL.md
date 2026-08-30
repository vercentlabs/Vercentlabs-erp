# AI Operating Model for a One-Person ERP Program

Use separate AI roles against the same repository truth. A writer must not self-approve.

| Role | Responsibility | Cannot self-approve |
|---|---|---|
| Product Manager | scope, capability map, dependencies, checkpoints | detailed feature completeness |
| Researcher | official benchmark/source evidence | product decision |
| Specification Writer | dossiers and normative requirements | research completeness |
| UX Designer | IA, workspaces, wireframes, responsive/mobile | domain correctness |
| Domain Architect | data/state/API/integrations | own red-team review |
| QA Engineer | tests, E2E, UAT, edge cases | implementation claims |
| Red-team Reviewer | omissions, inconsistencies, unsupported assumptions | original draft |

Every new chat/session begins from repository checkpoints and ends by updating evidence, registers, validators and the checkpoint. The conversation is disposable; the repository is authoritative.
