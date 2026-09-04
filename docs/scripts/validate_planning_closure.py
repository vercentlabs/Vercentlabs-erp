#!/usr/bin/env python3
from pathlib import Path
import csv
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
D = ROOT / "docs"
R = D / "02-register"
errors = []
def err(x): errors.append(x)

req = [
    D/'00-program/IMPLEMENTATION_MASTER_PLAN.md', D/'00-program/MASTER_WBS.md', D/'00-program/MILESTONE_PLAN.md', D/'00-program/RAID_REGISTER.csv',
    D/'00-program/SOLE_PROJECT_MANAGER_OPERATING_MODEL.md', D/'00-program/PROJECT_CAPACITY_PLAN.md', D/'00-program/SCHEDULE_MANAGEMENT_POLICY.md', D/'00-program/PROJECT_COST_MANAGEMENT_PLAN.md',
    D/'00-program/STAKEHOLDER_MANAGEMENT_PLAN.md', D/'00-program/COMMUNICATIONS_PLAN.md', D/'00-program/PROCUREMENT_EXTERNAL_SERVICES_PLAN.md', D/'00-program/PM_PLANNING_BASELINE.md',
    D/'08-implementation-plans/IMPLEMENTATION_WAVES.csv', D/'08-implementation-plans/MIGRATION_CUTOVER_PLAN.md', D/'08-implementation-plans/RELEASE_ROLLBACK_PLAN.md', D/'08-implementation-plans/PILOT_HYPERCARE_PLAN.md',
    D/'01-standards/TENANT_TRANSACTION_RLS_STANDARD.md', D/'01-standards/OPERATIONAL_RESILIENCE_STANDARD.md', D/'01-standards/AI_RUNTIME_GOVERNANCE.md', D/'04-shared-platform/EXPERIENCE_KERNEL.md',
    R/'TEST_TRACEABILITY_REGISTER.csv', R/'SEMANTIC_REVIEW_REGISTER.csv', R/'IMPLEMENTATION_SEQUENCE_BASELINE.csv', R/'PROJECT_COST_BASELINE.csv', R/'STAKEHOLDER_REGISTER.csv', R/'PM_PLANNING_BASELINE_REVIEW.csv',
    D/'00-program/PARALLEL_AI_IMPLEMENTATION_OPERATING_MODEL.md', R/'IMPLEMENTATION_EXECUTION_REGISTER.csv', R/'AGENT_WORK_PACKAGE_REGISTER.csv', R/'MIGRATION_RESERVATION_REGISTER.csv'
]
for p in req:
    if not p.exists(): err('missing ' + str(p.relative_to(ROOT)))

for p in (D/'05-cross-module').glob('*.md'):
    if p.name in {'README.md'}: continue
    if p.name in {'LEAD_TO_CASH.md','ORDER_TO_CASH.md','PROCURE_TO_PAY.md','PLAN_TO_PRODUCE.md','MANUFACTURING_QUALITY_STOCK.md','POS_TO_CASH.md','HIRE_TO_PAYROLL_TO_BOOKS.md','ASSET_TO_BOOKS.md','PROJECT_TO_CASH.md','SERVICE_TO_RESOLUTION.md'}:
        t = p.read_text(encoding='utf-8').lower()
        for token in ['status: `specification_ready`','idempotency','reversal','reconciliation','transaction','authorization','e2e','uat']:
            if token not in t: err(f'{p.name}: missing {token}')

with (R/'SUBREQUIREMENT_REGISTER.csv').open(encoding='utf-8-sig', newline='') as f: subs = list(csv.DictReader(f))
crit = {'FR','BR','VAL','CALC','SEC','INT','API','PERF','OBS','E2E','UAT'}
blank = [r['requirement_id'] for r in subs if r.get('requirement_type') in crit and not (r.get('test_ids') or '').strip()]
if blank: err(f'{len(blank)} critical requirements still lack test_ids')
with (R/'TEST_TRACEABILITY_REGISTER.csv').open(encoding='utf-8-sig', newline='') as f: tests = list(csv.DictReader(f))
tids = {r['test_id'] for r in tests}
for r in subs:
    if r.get('requirement_type') in crit:
        for tid in (r.get('test_ids') or '').split(';'):
            if tid and tid not in tids: err(f'{r["requirement_id"]}: unresolved test id {tid}')

pm = subprocess.run([sys.executable, str(D/'scripts/validate_pm_planning.py')], cwd=ROOT, text=True, capture_output=True)
if pm.returncode != 0:
    err('PM planning validator failed: ' + (pm.stdout + pm.stderr).strip().replace('\n',' | '))

parallel = subprocess.run([sys.executable, str(D/'scripts/validate_parallel_implementation.py')], cwd=ROOT, text=True, capture_output=True)
if parallel.returncode != 0:
    err('parallel governance validator failed: ' + (parallel.stdout + parallel.stderr).strip().replace('\n',' | '))

if errors:
    print('PLANNING CLOSURE VALIDATION FAILED')
    for x in errors[:100]: print(' -', x)
    sys.exit(1)
print('PLANNING CLOSURE VALIDATION PASSED')
print(' - technical planning/WBS/journeys/traceability present')
print(' - architecture/DR/Experience/AI standards present')
print(' - sole-PM integration accountability plus registered dependency-safe parallel AI controls present')
print(' - calendar timeline intentionally not baselined')
print(' - current RAID/checkpoint/wave authority reconciled')
