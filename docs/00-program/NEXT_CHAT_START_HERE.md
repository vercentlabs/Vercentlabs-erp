# Next Chat — Start Here

Status: `ACTIVE_EXECUTION_ENTRY_POINT`

This file is the first execution document an AI assistant should read after the repository is uploaded in a new chat.

## User interaction contract

The owner does **not** need to rewrite the implementation prompt every chat. When this repository is supplied and the user says only `continue`, `next`, `implement`, or equivalent, the assistant must:

1. read this file;
2. read `EXECUTION_PLAYBOOK.md`;
3. run/read `python docs/scripts/next_execution_step.py`;
4. load only the authority needed for that wave/stage;
5. audit the current repository before proposing edits;
6. continue from the recorded status instead of restarting completed work;
7. never ask the owner to restate the 510-feature plan, five-go model, Codex QA model, or final UAT model.

## Implementation-tool rule

- **ChatGPT is the implementation planner/command author.** It does not use Codex to implement the wave.
- For each implementation GO, ChatGPT produces one self-contained **Git Bash command** that applies that GO and runs its required deterministic checks.
- **Codex is reserved for independent post-GO5 user-style QA.** Codex must not silently fix its own findings.
- The owner performs the final human UAT/acceptance gate after Codex reports PASS.

## Current-state rule

Never assume documentation status equals code status. Reconcile existing implementation evidence before reimplementing anything. Preserve good existing code; replace/refactor weak existing code when the pre-production evolution policy permits it.

## Source locations

- Master workflow: `docs/00-program/EXECUTION_PLAYBOOK.md`
- Active dashboard: `docs/00-program/EXECUTION_DASHBOARD.md`
- Canonical feature plan: `docs/02-register/FEATURE_REGISTER.csv` + 510 dossiers under `docs/03-modules/*/features/`
- 98 capability groups: `docs/02-register/CAPABILITY_REGISTER.csv`
- 4,080 semantic sub-capabilities: `docs/02-register/FEATURE_SEMANTIC_SUBCAPABILITY_REGISTER.csv`
- 18,870 atomic requirements: `docs/02-register/SUBREQUIREMENT_REGISTER.csv`
- 5,100 flows: `docs/02-register/FEATURE_FLOW_REGISTER.csv`
- 2,550 transitions: `docs/02-register/FEATURE_STATE_TRANSITION_REGISTER.csv`
- Canonical wave DAG: `docs/02-register/IMPLEMENTATION_WAVE_REGISTER.csv`
- Five-go progress: `docs/02-register/WAVE_GO_EXECUTION_REGISTER.csv`
- Per-feature implementation/QA/UAT status: `docs/02-register/FEATURE_EXECUTION_STATUS.csv`
- Defects: `docs/02-register/DEFECT_REGISTER.csv`
- Codex QA protocol: `docs/09-test-plans/CODEX_WAVE_QA_PROTOCOL.md`
- Human UAT protocol: `docs/10-uat/HUMAN_UAT_PROTOCOL.md`
