from __future__ import annotations
import csv
from collections import Counter
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
D=ROOT/"docs"; R=D/"02-register"
def rows(name):
    with (R/name).open(encoding="utf-8",newline="") as f: return list(csv.DictReader(f))

go=rows("WAVE_GO_EXECUTION_REGISTER.csv")
fe=rows("FEATURE_EXECUTION_STATUS.csv")
lines=["# Execution Dashboard","","Generated from execution registers. Do not hand-edit.","","## Waves","", "| Wave | GO1 | GO2 | GO3 | GO4 | GO5 | Codex QA | Human UAT | Final |", "|---|---|---|---|---|---|---|---|---|"]
for r in go:
    lines.append(f"| {r['wave_id']} | {r['go1_status']} | {r['go2_status']} | {r['go3_status']} | {r['go4_status']} | {r['go5_status']} | {r['codex_qa_status']} | {r['human_uat_status']} | {r['final_acceptance_status']} |")
lines += ["", "## Feature status summary", ""]
for col in ["implementation_status","automated_verification_status","codex_qa_status","human_uat_status","final_acceptance_status"]:
    c=Counter(r[col] for r in fe)
    lines.append(f"### {col}")
    for k,v in sorted(c.items()): lines.append(f"- `{k}`: {v}")
    lines.append("")
(D/"00-program/EXECUTION_DASHBOARD.md").write_text("\n".join(lines)+"\n",encoding="utf-8")
