#!/usr/bin/env python3
from pathlib import Path
import csv, subprocess, sys
from parallel_governance_lib import planning_closure_is_complete
ROOT=Path(__file__).resolve().parents[2]; D=ROOT/"docs"; R=D/"02-register"; SP=D/"04-shared-platform"; P=D/"00-program"; blockers=[]
def rows(p):
    if not p.exists(): return []
    with p.open(encoding="utf-8-sig",newline="") as f:return list(csv.DictReader(f))
for name,n in [("SEMANTIC_REVIEW_REGISTER.csv",510),("FLOW_STATE_REVIEW_REGISTER.csv",510),("BENCHMARK_RELEVANCE_REVIEW.csv",510),("ARCHITECTURE_AI_FREEZE_REVIEW.csv",1),("FINAL_IMPLEMENTATION_AUTHORIZATION_REVIEW.csv",1)]:
    x=rows(R/name)
    if len(x)!=n or any((r.get("review_status") or "").upper()!="APPROVED" for r in x): blockers.append(name)
sp=rows(SP/"SHARED_PLATFORM_REGISTER.csv")
if len(sp)!=36 or any((r.get("specification_status") or r.get("status") or "").upper() not in {"SPECIFICATION_READY","APPROVED"} for r in sp): blockers.append("SP001-SP036")
pm=rows(R/"PM_PLANNING_BASELINE_REVIEW.csv")
if len(pm)!=1 or pm[0].get("review_status")!="APPROVED" or pm[0].get("accountable_owner")!="Project Manager" or pm[0].get("calendar_timeline_policy")!="NO_CALENDAR_TIMELINE_BASELINED" or pm[0].get("parallel_execution_policy")!="REGISTERED_DEPENDENCY_SAFE_AI_WORK_PACKAGES": blockers.append("PM_PLANNING_BASELINE_REVIEW.csv")
expected=["T00","T01"]+[f"W{i:02d}" for i in range(1,16)]; seq=rows(R/"IMPLEMENTATION_SEQUENCE_BASELINE.csv")
if [r.get("wave_id","") for r in seq]!=expected or any(r.get("accountable_owner")!="Project Manager" or r.get("pm_integration_wip_limit")!="1" for r in seq): blockers.append("IMPLEMENTATION_SEQUENCE_BASELINE.csv")
for p in [P/"PARALLEL_AI_IMPLEMENTATION_OPERATING_MODEL.md",R/"IMPLEMENTATION_EXECUTION_REGISTER.csv",R/"AGENT_WORK_PACKAGE_REGISTER.csv",R/"MIGRATION_RESERVATION_REGISTER.csv"]:
    if not p.exists(): blockers.append(str(p.relative_to(ROOT)))
parallel=subprocess.run([sys.executable,str(D/"scripts/validate_parallel_implementation.py")],cwd=ROOT,text=True,capture_output=True)
if parallel.returncode!=0: blockers.append("parallel governance: "+(parallel.stdout+parallel.stderr).strip().replace("\n"," | "))
if (R/"PROJECT_SCHEDULE_BASELINE.csv").exists(): blockers.append("forbidden PROJECT_SCHEDULE_BASELINE.csv")
if not rows(R/"PROJECT_COST_BASELINE.csv"): blockers.append("PROJECT_COST_BASELINE.csv")
if not rows(R/"STAKEHOLDER_REGISTER.csv"): blockers.append("STAKEHOLDER_REGISTER.csv")
closure=(P/"PLANNING_CLOSURE_STATUS.md").read_text(encoding="utf-8",errors="replace") if (P/"PLANNING_CLOSURE_STATUS.md").exists() else ""
if not planning_closure_is_complete(closure): blockers.append("PLANNING_CLOSURE_STATUS.md")
if blockers:
    print("PLANNING CLOSURE: BLOCKED")
    for x in blockers: print(" -",x)
    sys.exit(2)
print("PLANNING CLOSURE: PASS")
print("Technical planning remains closed under sole-Project-Manager accountability.")
print("Parallel AI execution is permitted only through registered dependency-safe work packages after execution-state reconciliation.")
print("Calendar timeline remains intentionally unbaselined.")
