#!/usr/bin/env python3
from pathlib import Path
import csv
import re
import subprocess
import sys

from parallel_governance_lib import planning_closure_is_complete, checkpoint_has_stale_begin_t00_authorization

ROOT = Path(__file__).resolve().parents[2]
D = ROOT / "docs"; P = D / "00-program"; R = D / "02-register"; I = D / "08-implementation-plans"
errors = []
def err(msg): errors.append(msg)
def rows(path):
    if not path.exists():
        err("missing " + str(path.relative_to(ROOT))); return []
    with path.open(encoding="utf-8-sig", newline="") as f: return list(csv.DictReader(f))

required = [
    P/"SOLE_PROJECT_MANAGER_OPERATING_MODEL.md", P/"PROJECT_CAPACITY_PLAN.md", P/"SCHEDULE_MANAGEMENT_POLICY.md",
    P/"PROJECT_COST_MANAGEMENT_PLAN.md", P/"STAKEHOLDER_MANAGEMENT_PLAN.md", P/"COMMUNICATIONS_PLAN.md",
    P/"PROCUREMENT_EXTERNAL_SERVICES_PLAN.md", P/"PM_PLANNING_BASELINE.md", P/"CURRENT_REBUILD_CHECKPOINT.md",
    P/"PLANNING_CLOSURE_STATUS.md", P/"RAID_REGISTER.csv", P/"PARALLEL_AI_IMPLEMENTATION_OPERATING_MODEL.md",
    R/"IMPLEMENTATION_SEQUENCE_BASELINE.csv", R/"PROJECT_COST_BASELINE.csv", R/"STAKEHOLDER_REGISTER.csv",
    R/"PM_PLANNING_BASELINE_REVIEW.csv", R/"IMPLEMENTATION_WAVE_REGISTER.csv", R/"IMPLEMENTATION_EXECUTION_REGISTER.csv",
    R/"AGENT_WORK_PACKAGE_REGISTER.csv", R/"MIGRATION_RESERVATION_REGISTER.csv", I/"IMPLEMENTATION_WAVES.csv",
]
for p in required:
    if not p.exists(): err("missing " + str(p.relative_to(ROOT)))

pm = rows(R/"PM_PLANNING_BASELINE_REVIEW.csv")
if len(pm) != 1: err("PM planning baseline review must contain exactly one row")
elif pm:
    r=pm[0]
    if r.get("review_status") != "APPROVED": err("PM planning baseline review is not APPROVED")
    if r.get("accountable_owner") != "Project Manager": err("PM baseline accountable owner must be Project Manager")
    if r.get("calendar_timeline_policy") != "NO_CALENDAR_TIMELINE_BASELINED": err("calendar timeline policy must be NO_CALENDAR_TIMELINE_BASELINED")
    if r.get("capacity_policy") != "PM_INTEGRATION_WIP_ONE_PARALLEL_AI_REGISTERED_NO_TIME_COMMITMENT": err("capacity policy must preserve one-at-a-time PM integration with registered parallel AI execution")
    if r.get("parallel_execution_policy") != "REGISTERED_DEPENDENCY_SAFE_AI_WORK_PACKAGES": err("parallel execution policy mismatch")
    if r.get("next_action") != "RECONCILE_EXECUTION_STATE_THEN_OPEN_REGISTERED_DEPENDENCY_SAFE_WORK_PACKAGES": err("next_action must require execution-state reconciliation before opening AWPs")
    for key in ("planning_closure","architecture_freeze","implementation_authorization"):
        if r.get(key) != "PASS": err(f"PM baseline {key} must be PASS")

expected=["T00","T01"]+[f"W{i:02d}" for i in range(1,16)]
authority=rows(R/"IMPLEMENTATION_WAVE_REGISTER.csv")
if [r.get("wave_id","") for r in authority] != expected: err("canonical implementation-wave authority is not T00,T01,W01-W15")
if any(r.get("planning_status") != "PLANNED_FROZEN" for r in authority): err("canonical wave planning_status must remain PLANNED_FROZEN")

seq=rows(R/"IMPLEMENTATION_SEQUENCE_BASELINE.csv")
if [r.get("wave_id","") for r in seq] != expected: err("implementation sequence baseline does not exactly mirror canonical wave authority")
for n,r in enumerate(seq,start=1):
    wid=r.get("wave_id")
    if r.get("sequence") != str(n): err(f"{wid}: incorrect sequence number")
    if r.get("accountable_owner") != "Project Manager": err(f"{wid}: owner is not Project Manager")
    if r.get("baseline_status") != "BASELINED": err(f"{wid}: row not BASELINED")
    if r.get("pm_integration_wip_limit") != "1": err(f"{wid}: pm_integration_wip_limit must be 1")
    if r.get("parallel_execution_policy") != "REGISTERED_DEPENDENCY_SAFE_WORK_PACKAGES": err(f"{wid}: parallel execution policy mismatch")
    if r.get("calendar_timeline_policy") != "NO_CALENDAR_TIMELINE_BASELINED": err(f"{wid}: timeline policy mismatch")
    forbidden={"wip_limit","planned_start","planned_finish","start_date","finish_date","deadline","duration","planned_focus_days","planned_focus_hours","effort_hours"}
    if forbidden.intersection(r.keys()): err("legacy WIP/timeline/effort columns must not exist in IMPLEMENTATION_SEQUENCE_BASELINE.csv")

mirror=rows(I/"IMPLEMENTATION_WAVES.csv")
if [r.get("wave_id","") for r in mirror] != expected: err("implementation wave mirror conflicts with canonical authority")
if any(r.get("accountable_owner") != "Project Manager" for r in mirror): err("implementation plan wave ownership must be Project Manager")
if any(r.get("planning_status") != "PLANNED_FROZEN" for r in mirror): err("implementation wave mirror planning_status mismatch")
if any(r.get("calendar_timeline_policy") != "NO_CALENDAR_TIMELINE_BASELINED" for r in mirror): err("implementation plan must preserve no-timeline policy")

costs=rows(R/"PROJECT_COST_BASELINE.csv")
if not costs: err("project cost baseline is empty")
for r in costs:
    if r.get("accountable_owner") != "Project Manager": err(f"{r.get('cost_id')}: cost owner is not Project Manager")
    try:
        if float(r.get("authorized_amount_inr","")) < 0: err(f"{r.get('cost_id')}: negative authorized amount")
    except ValueError: err(f"{r.get('cost_id')}: authorized_amount_inr must be numeric")
    if r.get("approval_status") not in {"NOT_AUTHORIZED_UNTIL_CHANGE","BASELINED"}: err(f"{r.get('cost_id')}: invalid approval_status")

stakeholders=rows(R/"STAKEHOLDER_REGISTER.csv")
if not stakeholders: err("stakeholder register is empty")
if any(r.get("accountable_owner") != "Project Manager" for r in stakeholders): err("all stakeholder engagement accountability must remain with Project Manager")
raid=rows(P/"RAID_REGISTER.csv")
if not raid: err("RAID register is empty")
if any(r.get("owner") != "Project Manager" for r in raid): err("all current RAID ownership must be Project Manager")
raid_by_id={r.get("raid_id"):r for r in raid}
for rid in ("R-010","R-011","R-012","R-013"):
    if rid not in raid_by_id: err(f"{rid}: parallel-AI governance risk is missing")

sole=(P/"SOLE_PROJECT_MANAGER_OPERATING_MODEL.md").read_text(encoding="utf-8",errors="replace") if (P/"SOLE_PROJECT_MANAGER_OPERATING_MODEL.md").exists() else ""
if "Sole accountable human role: `Project Manager`" not in sole: err("sole-PM accountability statement missing")
operating=(P/"PARALLEL_AI_IMPLEMENTATION_OPERATING_MODEL.md").read_text(encoding="utf-8",errors="replace") if (P/"PARALLEL_AI_IMPLEMENTATION_OPERATING_MODEL.md").exists() else ""
for token in ("Agent Work Package","PM integration","migration reservation","base commit","worktree"):
    if token.lower() not in operating.lower(): err(f"parallel operating model missing semantic token: {token}")

closure=(P/"PLANNING_CLOSURE_STATUS.md").read_text(encoding="utf-8",errors="replace") if (P/"PLANNING_CLOSURE_STATUS.md").exists() else ""
if not planning_closure_is_complete(closure): err("planning closure status is not current/complete")
checkpoint=(P/"CURRENT_REBUILD_CHECKPOINT.md").read_text(encoding="utf-8",errors="replace") if (P/"CURRENT_REBUILD_CHECKPOINT.md").exists() else ""
if checkpoint_has_stale_begin_t00_authorization(checkpoint): err("current checkpoint still contains stale Begin T00 authorization language")
if "RECONCILIATION_REQUIRED" not in checkpoint or "reconcil" not in checkpoint.lower(): err("current checkpoint must require execution-state reconciliation")

if (R/"PROJECT_SCHEDULE_BASELINE.csv").exists(): err("PROJECT_SCHEDULE_BASELINE.csv must not exist under no-timeline baseline")
if (P/"PROJECT_SCHEDULE_BASELINE.md").exists(): err("PROJECT_SCHEDULE_BASELINE.md must not exist under no-timeline baseline")
no_timeline=[P/"SOLE_PROJECT_MANAGER_OPERATING_MODEL.md",P/"PROJECT_CAPACITY_PLAN.md",P/"SCHEDULE_MANAGEMENT_POLICY.md",P/"PM_PLANNING_BASELINE.md",P/"CURRENT_REBUILD_CHECKPOINT.md",P/"PLANNING_CLOSURE_STATUS.md",R/"IMPLEMENTATION_SEQUENCE_BASELINE.csv",R/"PM_PLANNING_BASELINE_REVIEW.csv",I/"IMPLEMENTATION_WAVES.csv"]
iso_date=re.compile(r"\b20\d{2}-\d{2}-\d{2}\b")
for p in no_timeline:
    if p.exists():
        text=p.read_text(encoding="utf-8-sig",errors="replace")
        if iso_date.search(text): err(f"{p.relative_to(ROOT)} contains a calendar date under no-timeline policy")
        for token in ("planned_start","planned_finish","planned_focus_days","planned_focus_hours","hours/week","hours/day","long-range forecast"):
            if token in text: err(f"{p.relative_to(ROOT)} contains forbidden timeline/effort token: {token}")
cc=(P/"CHANGE_CONTROL.md").read_text(encoding="utf-8",errors="replace").lower() if (P/"CHANGE_CONTROL.md").exists() else ""
if "founder approval" in cc: err("current change control still assigns approval to a non-PM role")

parallel=subprocess.run([sys.executable,str(D/"scripts/validate_parallel_implementation.py")],cwd=ROOT,text=True,capture_output=True)
if parallel.returncode != 0: err("parallel governance validator failed: " + (parallel.stdout+parallel.stderr).strip().replace("\n"," | "))

if errors:
    print("PM PLANNING VALIDATION FAILED")
    for e in errors[:120]: print(" -",e)
    sys.exit(1)
print("PM PLANNING VALIDATION PASSED")
print(" - sole accountable human role: Project Manager")
print(" - PM integration WIP: 1; registered dependency-safe AI packages may execute concurrently")
print(" - canonical T00/T01/W01-W15 dependency authority preserved")
print(" - live execution/AWP/migration governance controls present and validated")
print(" - calendar timeline: intentionally NOT baselined")
print(" - cost, stakeholder, communications, procurement and RAID controls present")
