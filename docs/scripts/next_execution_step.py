from __future__ import annotations
import csv
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REG = ROOT / "docs" / "02-register"


def rows(name):
    with (REG / name).open(encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))

waves = rows("IMPLEMENTATION_WAVE_REGISTER.csv")
go = {r["wave_id"]: r for r in rows("WAVE_GO_EXECUTION_REGISTER.csv")}
accepted = {wid for wid, r in go.items() if r["final_acceptance_status"] == "ACCEPTED"}

for wave in waves:
    wid = wave["wave_id"]
    row = go[wid]
    if row["final_acceptance_status"] == "ACCEPTED":
        continue
    deps = [] if wave["depends_on"] in {"", "None"} else [x for x in wave["depends_on"].split(";") if x]
    missing = [d for d in deps if d not in accepted]
    if missing:
        continue

    go_fields = ["go1_status", "go2_status", "go3_status", "go4_status", "go5_status"]
    for i, field in enumerate(go_fields, 1):
        status = row[field]
        if status not in {"COMPLETE", "RECONCILED_COMPLETE", "RECONCILED_CANDIDATE"}:
            print(f"NEXT_STAGE={wid}:GO{i}")
            print(f"WAVE={wid} — {wave['name']}")
            print(f"STATUS={status}")
            print("ACTION=ChatGPT audits current repo and emits the single Git Bash implementation command for this GO.")
            raise SystemExit(0)

    if row["codex_qa_status"] != "PASS" and row["codex_qa_status"] != "LEGACY_EVIDENCE_ACCEPTED":
        print(f"NEXT_STAGE={wid}:CODEX_QA")
        print(f"WAVE={wid} — {wave['name']}")
        print("ACTION=Run independent Codex user-style full-wave QA. Codex reports; it does not silently fix.")
        raise SystemExit(0)

    if row["defect_loop_status"] not in {"CLOSED", "NOT_STARTED"}:
        print(f"NEXT_STAGE={wid}:DEFECT_LOOP")
        print(f"WAVE={wid} — {wave['name']}")
        print("ACTION=Send defect report to ChatGPT; apply fix command; rerun full Codex QA.")
        raise SystemExit(0)

    if row["human_uat_status"] not in {"PASS", "NOT_APPLICABLE", "LEGACY_ACCEPTED"}:
        print(f"NEXT_STAGE={wid}:HUMAN_UAT")
        print(f"WAVE={wid} — {wave['name']}")
        print("ACTION=Owner executes final feature-by-feature UAT; failures return to defect loop.")
        raise SystemExit(0)

    print(f"NEXT_STAGE={wid}:FINAL_RECONCILIATION")
    print(f"WAVE={wid} — {wave['name']}")
    print("ACTION=Reconcile feature statuses and canonical IMPLEMENTATION_EXECUTION_REGISTER exit gate to PASS.")
    raise SystemExit(0)

print("NEXT_STAGE=PROGRAM_COMPLETE")
