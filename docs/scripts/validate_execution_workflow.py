from __future__ import annotations
import csv, sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
D = ROOT / "docs"
R = D / "02-register"
errors=[]
def err(x): errors.append(x)
def rows(name):
    p=R/name
    if not p.exists(): err(f"missing {p.relative_to(ROOT)}"); return []
    with p.open(encoding="utf-8",newline="") as f: return list(csv.DictReader(f))

features=rows("FEATURE_REGISTER.csv")
capabilities=rows("CAPABILITY_REGISTER.csv")
semantic=rows("FEATURE_SEMANTIC_SUBCAPABILITY_REGISTER.csv")
requirements=rows("SUBREQUIREMENT_REGISTER.csv")
flows=rows("FEATURE_FLOW_REGISTER.csv")
states=rows("FEATURE_STATE_TRANSITION_REGISTER.csv")
fw=rows("FEATURE_IMPLEMENTATION_WAVE_REGISTER.csv")
waves=rows("IMPLEMENTATION_WAVE_REGISTER.csv")
go=rows("WAVE_GO_EXECUTION_REGISTER.csv")
fe=rows("FEATURE_EXECUTION_STATUS.csv")
_ = rows("DEFECT_REGISTER.csv")

expected=[f"F{i:03d}" for i in range(1,511)]
if [x.get("feature_id") for x in features] != expected: err("canonical feature register is not exact F001-F510")
if len(capabilities)!=98: err(f"capability count={len(capabilities)} expected 98")
if len(semantic)!=4080: err(f"semantic count={len(semantic)} expected 4080")
if len(requirements)!=18870: err(f"requirement count={len(requirements)} expected 18870")
if len(flows)!=5100: err(f"flow count={len(flows)} expected 5100")
if len(states)!=2550: err(f"state transition count={len(states)} expected 2550")
if len(waves)!=17 or len(go)!=17: err("wave/go register must cover T00,T01,W01-W15")
if [x.get("feature_id") for x in fe] != expected: err("FEATURE_EXECUTION_STATUS must contain exact ordered F001-F510")

cap_count=Counter()
for c in capabilities:
    for fid in (c.get("feature_ids") or "").split(";"):
        if fid: cap_count[fid]+=1
for fid in expected:
    if cap_count[fid]!=1: err(f"{fid}: capability ownership count {cap_count[fid]} != 1")

for name,data,n in [("semantic",semantic,8),("requirements",requirements,37),("flows",flows,10),("states",states,5)]:
    c=Counter(x.get("feature_id") for x in data)
    bad=[fid for fid in expected if c[fid]!=n]
    if bad: err(f"{name}: per-feature cardinality mismatch for {bad[:10]}")

required_docs=[
    D/"00-program/NEXT_CHAT_START_HERE.md",
    D/"00-program/EXECUTION_PLAYBOOK.md",
    D/"00-program/PRE_PRODUCTION_EVOLUTION_POLICY.md",
    D/"00-program/DOCUMENT_LIFECYCLE_POLICY.md",
    D/"01-standards/WEB_FRONTEND_ARCHITECTURE.md",
    D/"09-test-plans/CODEX_WAVE_QA_PROTOCOL.md",
    D/"10-uat/HUMAN_UAT_PROTOCOL.md",
]
for p in required_docs:
    if not p.exists(): err(f"missing {p.relative_to(ROOT)}")

if errors:
    print("EXECUTION WORKFLOW VALIDATION FAILED")
    for e in errors: print(" -",e)
    sys.exit(1)
print("EXECUTION WORKFLOW VALIDATION PASSED")
print(" - 510 features / 98 capabilities")
print(" - 4,080 semantic sub-capabilities / 18,870 requirements")
print(" - 5,100 flows / 2,550 state transitions")
print(" - T00,T01,W01-W15 five-go execution coverage")
print(" - Codex QA + human UAT gates present")
